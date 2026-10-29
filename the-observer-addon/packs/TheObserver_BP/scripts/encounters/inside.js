// @ts-check
// E21 "It's Inside" — at night, when the player comes home, it is not outside the window. It is
// standing in the darkest corner of the room behind them, eyes glowing, waiting to be noticed.
// Rare by design: stage 4+, at most once every 3 in-game nights, only in a dark (light 7 or less),
// roofed room of the player's own home, never inside a Ward Lantern's radius.
// It leaves when the room is lit (light 10+ where it stands: a torch, a flare), when it has been
// stared at for 2 seconds, or when the player walks right up to it (a room-sized too-close reaction).
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { V, safe } from "../core/util.js";
import { standAt, coverSide } from "../world/space.js";
import { visibility, lineOfSight, bodyPoints } from "../world/sight.js";
import { sighting } from "./common.js";

/** A dark, roofed standing spot in the same room, out of the player's current view. @param {import("@minecraft/server").Player} p */
export function insideSpot(p) {
  const dim = p.dimension;
  const eye = p.getHeadLocation();
  const base = p.location;
  let best;
  for (let i = 0; i < 48; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * 7;
    const st = standAt(dim, base.x + Math.cos(a) * d, base.z + Math.sin(a) * d, base.y + 1.5, 3);
    if (!st || st.liquid || Math.abs(st.loc.y - base.y) > 1.1) continue;
    const head = bodyPoints(st.loc, st.stoop)[2];
    const roof = safe(() => dim.getBlockAbove(head, { includePassableBlocks: false, maxDistance: 6 }));
    if (!roof) continue;
    const light = safe(() => dim.getLightLevel(head), 15) ?? 15;
    if (light > 7) continue;
    if (!lineOfSight(dim, head, eye).clear) continue; // the same room
    if (visibility(p, st.loc, { stooped: st.stoop, fov: 70 }).points > 0) continue; // behind them
    const corner = coverSide(dim, st.loc, eye).has ? 2 : 0;
    const score = (7 - light) * 0.4 + corner + Math.random();
    if (!best || score > best.score) best = { ...st, score };
  }
  return best;
}

register({
  id: "inside",
  tier: 3,
  minStage: 4,
  needsBody: true,
  minManip: 0,
  cooldown: 3600,
  weight(c) {
    if (c.d !== 0 || !c.night || !c.sheltered || c.underground || c.water) return 0;
    if (!c.haunt || c.hauntDist > 14) return 0;
    return 7;
  },
  prepare(enc) {
    const spot = insideSpot(enc.p);
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    const spot = enc.data.spot;
    // indoors the too-close reaction is room-sized: walk right up to it (2-4 blocks, always closer than
    // where it stands, so it does not vanish the moment it arrives) and it is gone
    enc.data.nearDist = Math.max(2, Math.min(2.5 + Math.random() * 1.5, V.dist(spot.loc, p.location) - 1));
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop, silent: true })) return enc.result("deferred");
    let noticed = false;
    for (let t = 0; t < 20 * 60; t += 4) {
      await enc.wait(4);
      const l = body.loc();
      if (!l) return enc.result("vanished");
      if (V.dist(l, p.location) > 24) return enc.result(noticed ? "left_home" : "unnoticed", noticed);
      // light the room and it is gone
      const head = bodyPoints(l, !!body.get()?.stoop)[2];
      const light = safe(() => dim.getLightLevel(head), 0) ?? 0;
      if (light >= 10) {
        body.setState("recoil");
        await enc.wait(10);
        enc.discover("it_was_inside");
        enc.result("lit_room", true);
        body.despawn("lit");
        return;
      }
      enc.updateGaze();
      if (!noticed && enc.gaze.seenTicks >= 6) {
        noticed = true;
        sighting(enc, enc.gaze.lastWatcher ?? p);
      }
      if (enc.gaze.seenTicks >= 40) {
        body.setState("tilt");
        await enc.wait(16);
        enc.discover("it_was_inside");
        enc.result("stared", true);
        body.despawn("stared");
        return;
      }
    }
    enc.result(noticed ? "waited" : "unnoticed", noticed);
  },
});
