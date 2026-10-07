// @ts-check
// E14 "At the Window" — the player is indoors. Outside, it stands where it can see them through
// glass, a pane or an opening, framed by the wall. Seen, it steps out of the frame. Footprints stay
// outside under the window.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { V, safe } from "../core/util.js";
import { standNear } from "../world/space.js";
import { visibility, lineOfSight, bodyPoints } from "../world/sight.js";
import { observe, sighting, acknowledge, trailAway } from "./common.js";

/** Search around the player for an outdoor spot that sees them through a see-through block or opening. */
function windowSpot(enc) {
  const p = enc.p;
  const dim = enc.dim;
  const eye = p.getHeadLocation();
  let best;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 6 + Math.random() * 12;
    const x = p.location.x + Math.cos(a) * d, z = p.location.z + Math.sin(a) * d;
    const st = standNear(dim, x, z, p.location.y);
    if (!st) continue;
    const head = bodyPoints(st.loc, st.stoop)[2];
    const sky = safe(() => dim.getSkyLightLevel(head), 0) ?? 0;
    if (sky < 10) continue; // must be outside
    const los = lineOfSight(dim, head, eye);
    if (!los.clear) continue;
    const vis = visibility(p, st.loc, { stooped: st.stoop, fov: 85 });
    // framed: not every body point visible (the wall hides part of it), or seen through glass
    const framed = los.through > 0 || (vis.points > 0 && vis.points < 3);
    if (!framed) continue;
    if (visibility(p, st.loc, { stooped: st.stoop, fov: 60 }).points > 0) continue; // don't appear in plain view
    const score = (los.through > 0 ? 3 : 1) + Math.random();
    if (!best || score > best.score) best = { ...st, score };
  }
  return best;
}

register({
  id: "window_watch",
  tier: 2,
  minStage: 2,
  needsBody: true,
  cooldown: 900,
  benign: true,
  weight(c) {
    if (!c.sheltered || c.underground || c.water || c.d !== 0) return 0;
    return c.hauntDist < 32 ? 14 : 8;
  },
  prepare(enc) {
    const s = windowSpot(enc);
    if (!s) return false;
    enc.data.spot = s;
    return true;
  },
  async run(enc) {
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop })) return enc.result("deferred");
    const r = await observe(enc, { maxTicks: 20 * 50, noticeTicks: 12 });
    if (r.noticed) {
      sighting(enc, r.by ?? enc.p);
      enc.discover("the_window", r.by ?? enc.p);
      await acknowledge(enc, 6, 10);
    } else enc.result("unnoticed");
    enc.leaveTrace(trailAway(enc.dim, spot.loc, enc.p.location, 6));
    const b = body.get();
    if (b) b.faceTarget = false;
  },
});
