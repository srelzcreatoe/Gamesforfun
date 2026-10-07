// @ts-check
// E8 "Lights Out" — the lights around the player go out one by one, farthest first, each with a
// soft snuff. It is a test: relight one (or place a new light) and it acknowledges you from the
// edge of the dark and leaves. Ignore it and it watches a while; the lights come back on their
// own a few minutes later if nobody has touched those spots.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS, PARTICLES } from "../core/constants.js";
import { V, randInt, safe } from "../core/util.js";
import { litLightsNear, manip } from "../world/manipulate.js";
import { findSpot } from "../world/space.js";
import { sighting, acknowledge } from "./common.js";

const LIGHT_RX = /torch|lantern|candle|campfire|glowstone|froglight|shroomlight|sea_lantern|lamp|jack_o_lantern|lit_pumpkin|end_rod|beacon|light_block/;

register({
  id: "snuffed_lights",
  tier: 2,
  minStage: 2,
  needsBody: true,
  minManip: 1,
  cooldown: 900,
  weight(c, s) {
    if (c.water || c.gliding) return 0;
    if (!(c.night || c.underground || c.sheltered)) return 0;
    const lightHabit = (s.habits.light || 0) > 1 ? 1.5 : 1; // it learned you rely on light
    return 8 * lightHabit;
  },
  prepare(enc) {
    const lights = litLightsNear(enc.dim, enc.p.location, 12, 8);
    // with manipulation 1 only candles/campfires can be put out
    const usable = manip() >= 2 ? lights : lights.filter((l) => !/torch|lantern/.test(enc.dim.getBlock(l)?.typeId ?? ""));
    if (usable.length < 2) return false;
    enc.data.lights = usable.sort((a, b) => V.dist(b, enc.p.location) - V.dist(a, enc.p.location)).slice(0, 4);
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const out = [];
    for (const l of enc.data.lights) {
      if (enc.snuff(l, 8 * 60)) {
        out.push(l);
        const c = { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 };
        enc.sound(SOUNDS.snuff, c, 0.7, 1, out.length === 1 ? "caption.snuff" : undefined);
        enc.particle(PARTICLES.unravel, c);
      }
      await enc.wait(randInt(22, 40));
    }
    if (out.length === 0) return enc.result("nothing");
    enc.fog("soft");
    // it stands at the edge of the new darkness
    const spot = findSpot(p, { minDist: 9, maxDist: 16, concealment: "partial", needLOS: true, hideFrom: enc.witnesses() });
    if (spot) enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop, side: spot.side });
    let relit = false;
    // relighting counts whether they put a light back where it was or bring a new one
    const lightAt = () => safe(() => enc.dim.getLightLevel(p.getHeadLocation()), 0) ?? 0;
    const darkLevel = lightAt();
    const darkSpot = p.location;
    for (let t = 0; t < 20 * 35 && !relit; t += 4) {
      await enc.wait(4);
      relit = enc.released.some((r) => r.how === "player_restored" || r.how === "player_changed")
        || enc.inputs.some((i) => i.kind === "place" && LIGHT_RX.test(i.typeId) && V.dist(i.loc, darkSpot) < 14)
        || (lightAt() >= darkLevel + 4 && V.dist(p.location, darkSpot) < 6);
      if (body.get()) {
        enc.updateGaze();
        if (enc.gaze.seenTicks >= 16 && !enc.noticed) sighting(enc, enc.gaze.lastWatcher ?? p);
      }
    }
    enc.clearFog();
    if (relit) {
      enc.result("relit", true);
      enc.discover("lights_out");
      if (body.get() && body.watchedBy([p], 70)) await acknowledge(enc, 6, 18);
      enc.restoreDelay = 20;
    } else {
      if (!enc.noticed) enc.result("sat_in_dark");
      enc.restoreDelay = randInt(150, 240);
    }
  },
});
