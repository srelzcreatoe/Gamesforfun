// @ts-check
// E2 SIGNATURE "Out of Step"
// Stalking + discrepancy: footsteps behind the player fall exactly in their rhythm (one step per
// ~1.65 blocks the player walks, on the ground material behind them). When the player stops,
// the steps stop too — and then one more, heavier step lands.
// Player choices:
//   turn around within the response window -> a glimpse of it between cover, it steps away (peaceful)
//   sneak while the steps follow           -> its rhythm falters and it gives up (peaceful)
//   keep walking / ignore it                -> the steps close in; at higher stages it is right behind you
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS, stepSoundFor } from "../core/constants.js";
import { V, safe, rand } from "../core/util.js";
import { findSpot } from "../world/space.js";
import { visibility } from "../world/sight.js";
import { observe, sighting, acknowledge, trailAway } from "./common.js";

/** Ground block under a point (for matching step sounds). */
function groundType(dim, loc) {
  const b = safe(() => dim.getBlockBelow({ x: loc.x, y: loc.y + 0.5, z: loc.z }, { includePassableBlocks: false, maxDistance: 4 }));
  return b ? b.typeId : "minecraft:stone";
}

register({
  id: "extra_step",
  tier: 2,
  minStage: 2,
  needsBody: true,
  cooldown: 600,
  weight(c) {
    if (!c.moving || c.water || c.gliding || c.elevated) return 0;
    return c.night || c.underground || c.light < 8 ? 12 : 8;
  },
  prepare(enc) {
    return enc.ctx.moving && !enc.p.isSneaking;
  },
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    let last = p.location;
    let acc = 0;
    let steps = 0;
    let stillTicks = 0;
    let distBehind = 7.5;
    let outcome = "";
    /** @type {{at:number, loc:any}[]} */
    const queue = [];
    // "behind" follows the direction of travel, not the camera, so turning around can be detected
    let trail = V.flat(p.getViewDirection());
    const behindPoint = () => {
      const back = V.scale(trail, -distBehind);
      return { x: p.location.x + back.x, y: p.location.y, z: p.location.z + back.z };
    };
    const lookingBehind = (deg) => V.angle(V.flat(p.getViewDirection()), V.scale(trail, -1)) < deg;
    const play = (loc, heavy) => {
      const snd = heavy ? SOUNDS.step : stepSoundFor(groundType(dim, loc));
      enc.sound(snd, loc, heavy ? 0.9 : 0.55, heavy ? 0.8 : 0.82);
    };

    // ---- phase A: matched footsteps
    for (let t = 0; t < 20 * 16; t += 2) {
      await enc.wait(2);
      const now = p.location;
      const moved = V.hdist(now, last);
      if (moved > 0.08) trail = V.flat(V.sub(now, last));
      last = now;
      acc += moved;
      while (queue.length && queue[0].at <= enc.tick) play(/** @type {any} */ (queue.shift()).loc, false);
      if (acc >= 1.65) {
        acc -= 1.65;
        steps++;
        queue.push({ at: enc.tick + 3, loc: behindPoint() });
        if (steps === 3) enc.caption("caption.steps_behind");
      }
      if (p.isSneaking && steps >= 2) {
        // its rhythm falters: two uneven steps, then nothing
        const l = behindPoint();
        play(l, false);
        await enc.wait(9);
        play(l, false);
        enc.result("faltered", true);
        enc.discover("quiet_feet");
        outcome = "quiet";
        break;
      }
      stillTicks = moved < 0.04 ? stillTicks + 2 : 0;
      const lookingBack = steps >= 2 && lookingBehind(70);
      if ((stillTicks >= 6 && steps >= 3) || lookingBack) {
        outcome = lookingBack ? "turned" : "stopped";
        break;
      }
      if (steps >= 22) break;
    }
    if (outcome === "quiet") return;
    if (!outcome) return enc.result("walked_on");

    // ---- the extra step (only when the player stopped without looking)
    const trailYaw = V.yawTo({ x: 0, y: 0, z: 0 }, trail);
    if (outcome === "stopped") {
      await enc.wait(8);
      play(behindPoint(), true);
    }

    // ---- phase B: it is there, between cover, once you turn
    const spot = findSpot(p, {
      minDist: 15, maxDist: 24, bearings: [180], spread: 28, baseYaw: trailYaw,
      concealment: outcome === "turned" ? "any" : "hidden", watchLOSIgnoringView: true, hideFrom: enc.witnesses(),
    });
    if (!spot) return enc.result("no_spot");
    if (!enc.spawnBody(spot.loc, { state: spot.vis === 1 || spot.vis === 2 ? "peek" : "watch", stoop: spot.stoop, side: spot.side })) return;
    const r = await observe(enc, { maxTicks: 100, noticeTicks: 6, approachDist: 9 });
    if (r.noticed || r.approached) {
      sighting(enc, r.by ?? p);
      enc.discover("out_of_step");
      await acknowledge(enc, 10, 16);
      enc.leaveTrace(trailAway(dim, spot.loc, p.location, 6));
      return;
    }

    // ---- ignored: the steps come closer
    if (enc.s.stage < 4) return enc.result("ignored");
    body.despawn("reposition");
    distBehind = 3.4;
    let turned = false;
    for (let t = 0; t < 160 && !turned; t += 2) {
      await enc.wait(2);
      const now = p.location;
      const moved = V.hdist(now, last);
      if (moved > 0.08) trail = V.flat(V.sub(now, last));
      acc += moved;
      last = now;
      if (acc >= 1.65) {
        acc -= 1.65;
        play(behindPoint(), false);
      }
      turned = lookingBehind(75);
      if (!turned && t === 60) {
        // it stands right behind them now, out of view
        const close = findSpot(p, { minDist: 4, maxDist: 6, bearings: [180], spread: 20, baseYaw: V.yawTo({ x: 0, y: 0, z: 0 }, trail), concealment: "hidden" });
        if (close) enc.spawnBody(close.loc, { state: "stare", stoop: close.stoop });
        enc.sound(SOUNDS.breath, behindPoint(), 0.7, 1, "caption.breath");
      }
    }
    const b = body.get();
    if (turned && b && visibility(p, b.e.location, { stooped: b.stoop, fov: 70 }).points > 0) {
      enc.result("faced_close", true);
      enc.discover("close");
      if (enc.canScare()) {
        enc.usedScare();
        enc.sound(SOUNDS.sting, b.e.location, 0.9);
        enc.shake(0.35, 0.5);
      }
      body.setState("tilt");
      await enc.wait(Math.round(rand(18, 26)));
      if (enc.fade(0.25, 0.5, 0.9)) {
        await enc.wait(6);
        body.despawn("faded");
      }
    } else enc.result("ignored");
  },
});
