// @ts-check
// E24 "In the Mire" — the Weeping Mire is its home. Out among the weeping trees it stands and watches
// (20-48 blocks, peeking from behind a trunk when there is one); after you read a torn page it may be
// behind you instead (always, after the last of the eight). This is the Mire's old "watcher", now the
// Observer itself:
//   * looked at for a second, it holds your gaze: the standoff (common.standoff) — look away and it is gone
//     in black mist with a cave sound; stare too long, or shoot it, and it snaps (from stage 2 it may lunge
//     at once instead — see common.wantsLunge)
//   * come within 9 blocks and it does not wait for you
//   * ignored, it fades after 90-180 seconds
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { V, safe, rand, allPlayers } from "../core/util.js";
import { visibility } from "../world/sight.js";
import { hideSpot } from "../world/space.js";
import { findSpotLoose, sighting, wantsLunge, lunge, standoff } from "./common.js";

/** Placement asked for by a torn page (player id -> options), read once by prepare. */
export const pending = new Map();

/** Black mist where it stood and a cave noise for everyone near, then it tears apart. @param {any} enc */
function vanishInMist(enc) {
  const l = body.loc();
  if (l) {
    safe(() => enc.dim.spawnParticle("wmire:black_mist", { x: l.x, y: l.y + 1.2, z: l.z }));
    for (const p of allPlayers()) {
      if (p.dimension.id === enc.dimId && V.dist(p.location, l) <= 40) safe(() => p.playSound("ambient.cave", { location: l, volume: 0.7, pitch: 0.6 }));
    }
  }
  body.despawn("mire");
}

register({
  id: "mire_watcher",
  tier: 1,
  minStage: 1,
  needsBody: true,
  benign: true,
  cooldown: 300,
  weight(c) {
    if (!c.mire || c.water || c.gliding) return 0;
    return 16;
  },
  prepare(enc) {
    const p = enc.p;
    const o = pending.get(p.id);
    pending.delete(p.id);
    const yMode = /** @type {"near"} */ ("near");
    // in plain sight once you turn round / between the trunks; the Mire is thick with trees, so closer if it
    // must, and as a last resort deep among them, like the Mire's old watcher, whether or not you can see it yet
    const surface = /** @type {"surface"} */ ("surface");
    const spot = o?.behind
      ? findSpotLoose(p, [
        { minDist: o.minDist, maxDist: o.maxDist, bearings: [180], spread: 25, concealment: "hidden", watchLOSIgnoringView: true, yMode, samples: 48 },
        { minDist: o.minDist, maxDist: o.maxDist + 6, bearings: [180, 140, -140], spread: 30, concealment: "hidden", watchLOSIgnoringView: true, yMode, samples: 48 },
        { minDist: 8, maxDist: o.minDist, bearings: [180, 140, -140], spread: 35, concealment: "hidden", watchLOSIgnoringView: true, yMode, samples: 48 },
        { minDist: o.minDist, maxDist: o.maxDist + 6, bearings: [180, 140, -140], spread: 30, concealment: "hidden", yMode, samples: 40 },
      ])
      : hideSpot(p, { minDist: 16, maxDist: 40 }) ?? findSpotLoose(p, [
        { minDist: 20, maxDist: 48, concealment: "partial", needLOS: true, preferCover: true, yMode, samples: 48 },
        { minDist: 20, maxDist: 48, concealment: "any", needLOS: true, yMode: surface, samples: 48 },
        { minDist: 12, maxDist: 24, concealment: "partial", needLOS: true, preferCover: true, yMode, samples: 48 },
        { minDist: 20, maxDist: 48, concealment: "any", yMode: surface, samples: 40 },
      ]);
    if (!spot) return false;
    enc.data.spot = spot;
    enc.data.why = o?.why ?? "ambient";
    // can the player see it at all once they turn that way?
    enc.data.los = visibility(p, spot.loc, { stooped: spot.stoop, ignoreView: true }).points > 0;
    return true;
  },
  async run(enc) {
    const spot = enc.data.spot;
    // walk within 9 blocks of it and it is gone
    enc.data.nearDist = 9;
    // among the weeping trees it hides behind a trunk and looks round it at you, when there is one
    const peek = enc.data.why === "ambient" && (spot.vis === 1 || spot.vis === 2);
    if (!enc.spawnBody(spot.loc, { state: peek ? "peek" : "watch", stoop: spot.stoop, side: spot.side, hide: spot.hide })) return enc.result("deferred");
    enc.emit("mire", { what: "watcher", why: enc.data.why, los: enc.data.los });
    const life = Math.floor(rand(90, 180) * 20);
    for (let t = 0; t < life; t += 4) {
      await enc.wait(4);
      if (!body.loc()) return enc.result("vanished");
      enc.updateGaze();
      if (enc.gaze.seenTicks >= 20) {
        const by = enc.gaze.lastWatcher ?? enc.p;
        sighting(enc, by);
        if (enc.ctx.mire) enc.discover("its_home", by);
        if (wantsLunge(enc)) {
          await lunge(enc);
          return;
        }
        // the standoff: it holds your gaze — stare too long and it snaps; look away and it is gone in mist
        body.setState("stare");
        enc.result("seen_in_the_mire", true);
        await standoff(enc, { gone: () => vanishInMist(enc) });
        return;
      }
    }
    vanishInMist(enc);
    enc.result("faded");
  },
});
