// @ts-check
// E1 "The Figure at the Edge" — distant observation at the edge of attention.
// Placement adapts to context: open ground (peripheral, partly behind cover), caves (closer),
// open water (it stands on the surface and sinks when approached), elevated builds (it stands
// on the ground below, looking up), and sometimes at the player's favoured bearing.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { animalsFace } from "../world/manipulate.js";
import { observe, sighting, favouredBearing, bearingHit, trailAway, findSpotLoose, sink } from "./common.js";
import { V, chance, rand } from "../core/util.js";

register({
  id: "distant_watch",
  tier: 1,
  minStage: 1,
  needsBody: true,
  cooldown: 240,
  benign: true,
  weight(c) {
    if (c.gliding) return 0;
    let w = 12;
    if (c.sheltered && !c.underground && c.hauntDist < 24) w *= 0.3;
    if (c.elevated) w *= 1.4;
    return w;
  },
  prepare(enc) {
    const p = enc.p, c = enc.ctx;
    const hideFrom = enc.witnesses();
    let spot;
    let mode = "ground";
    if (c.water) {
      mode = "water";
      spot = findSpotLoose(p, [
        { minDist: 26, maxDist: 42, bearings: [60, 100, -60, -100, 140, -140], liquidSurface: true, preferLiquid: true, samples: 32, yMode: "surface", concealment: "any", needLOS: true, hideFrom },
      ]);
    } else if (c.elevated) {
      mode = "below";
      spot = findSpotLoose(p, [
        { minDist: 6, maxDist: 22, yMode: "below", concealment: "any", needLOS: true, hideFrom },
        { minDist: 10, maxDist: 30, yMode: "surface", concealment: "any", needLOS: true, hideFrom },
      ]);
    } else if (enc.s.stage >= 2 && chance(0.35)) {
      mode = "bearing";
      const fb = favouredBearing(enc);
      spot = findSpotLoose(p, [
        { minDist: fb.dist + 6, maxDist: fb.dist + 12, bearings: [fb.bearing], spread: 6, concealment: "hidden", watchLOSIgnoringView: true, hideFrom, yMode: c.underground ? "near" : "surface" },
      ]);
    }
    if (!spot) {
      const near = c.underground || c.d === 1;
      mode = "ground";
      spot = findSpotLoose(p, [
        { minDist: near ? 14 : 26, maxDist: near ? 26 : 44, bearings: [70, 100, -70, -100, 125, -125], spread: 15, concealment: "partial", needLOS: true, hideFrom, yMode: near ? "near" : "surface" },
        { minDist: near ? 12 : 22, maxDist: near ? 28 : 46, concealment: "any", needLOS: true, hideFrom, yMode: near ? "near" : "surface" },
      ]);
    }
    if (!spot) return false;
    enc.data.spot = spot;
    enc.data.mode = mode;
    return true;
  },
  async run(enc) {
    const { spot, mode } = enc.data;
    const peek = spot.vis === 1 || spot.vis === 2;
    if (!enc.spawnBody(spot.loc, { state: peek ? "peek" : "watch", stoop: spot.stoop, side: spot.side })) return enc.result("deferred");
    enc.log(`mode=${mode} dist=${V.dist(spot.loc, enc.p.location).toFixed(1)} vis=${spot.vis}`);
    if (enc.s.stage >= 2 && chance(0.3)) animalsFace(enc.dim, enc.p.location, spot.loc, 24, 160);
    const r = await observe(enc, { maxTicks: 45 * 20, noticeTicks: 18, approachDist: mode === "water" ? 20 : 14 });
    if (r.noticed) {
      sighting(enc, r.by ?? enc.p);
      if (mode === "bearing") bearingHit(enc);
      body.setState("stare");
      await enc.wait(Math.round(rand(10, 26)));
      if (spot.liquid) await sink(enc);
    } else if (r.approached) {
      enc.result("approached", true);
      if (spot.liquid) await sink(enc);
    } else {
      enc.result("unnoticed");
      enc.leaveTrace(trailAway(enc.dim, spot.loc, enc.p.location, 7));
    }
  },
});
