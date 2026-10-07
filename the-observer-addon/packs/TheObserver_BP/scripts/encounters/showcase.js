// @ts-check
// Config Wheel "See it now": a preview, not part of the story. The Observer appears a few blocks in
// front of the player and shows each of its animation states, named on the action bar, then walks
// away. Works in any game mode and even while The Observer is switched off; it never attacks,
// changes no blocks and gives no progress.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { safe } from "../core/util.js";
import { findSpot } from "../world/space.js";

/** state, ticks shown */
const STEPS = [["watch", 60], ["stare", 60], ["tilt", 70], ["peek", 60], ["walk", 70], ["run", 50], ["attack", 40], ["recoil", 30], ["stare", 30]];

register({
  id: "showcase",
  tier: 0,
  minStage: 0,
  needsBody: true,
  manual: true,
  preview: true,
  benign: true,
  cooldown: 0,
  weight: () => 0,
  prepare(enc) {
    const p = enc.p;
    const spot = findSpot(p, { minDist: 5, maxDist: 9, bearings: [0], spread: 45, concealment: "visible", needLOS: true, yMode: "near", samples: 36 })
      ?? findSpot(p, { minDist: 4, maxDist: 12, bearings: [0, 90, -90, 180], spread: 45, concealment: "any", yMode: "near", samples: 48 });
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const spot = enc.data.spot;
    if (!enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop, side: spot.side })) return enc.result("deferred");
    for (const [state, ticks] of STEPS) {
      body.setState(/** @type {string} */ (state));
      safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: `observer.ui.showcase.${state}` }] }));
      await enc.wait(/** @type {number} */ (ticks));
    }
    safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.showcase.leave" }] }));
    enc.result("shown");
  },
});
