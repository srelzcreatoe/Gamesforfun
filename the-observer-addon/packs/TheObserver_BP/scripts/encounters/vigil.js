// @ts-check
// E18 "The Vigil" — the long-term objective. Started by the player from the Field Notes, at night,
// near the place they return to most, once 12 discoveries are recorded and they carry a Witness Lens.
// Three rounds. Each round it rearranges the area (lights out, a door, a screen of Veil) and hides
// somewhere within the grounds; a chime tells the player which way to look. Hold it in the Witness
// Lens (or hold its gaze for three seconds) within a minute to complete the round.
// Success: it stands in the open, tilts its head, and walks away. The player is Witnessed.
// Failure: it is behind them; blackout; the vigil can be kept again another night. No damage.
// World-wide effect (optional setting): rain for the duration of the vigil — announced as global.
import { world, WeatherType } from "@minecraft/server";
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS, PARTICLES, ITEMS } from "../core/constants.js";
import { V, safe, rand, allPlayers } from "../core/util.js";
import { S } from "../core/settings.js";
import { markPlayerDirty } from "../core/state.js";
import { findSpot } from "../world/space.js";
import { litLightsNear, findBlocks, OPENABLE } from "../world/manipulate.js";
import { give } from "../progression/discoveries.js";
import { primaryHaunt } from "../observer/memory.js";
import { visibility } from "../world/sight.js";

/** A 2x3 screen of veil cells between two points (breaks a sightline), only into open air. */
function screenBetween(dim, a, b) {
  const mid = V.lerp(a, b, rand(0.35, 0.6));
  const dir = V.flat(V.sub(b, a));
  const side = { x: -dir.z, y: 0, z: dir.x };
  const ground = safe(() => dim.getBlockBelow({ x: mid.x, y: mid.y + 3, z: mid.z }, { includePassableBlocks: false, maxDistance: 8 }));
  if (!ground) return [];
  const cells = [];
  for (const s of [-1, 0, 1]) for (const h of [1, 2]) cells.push({ x: Math.floor(mid.x + side.x * s), y: ground.location.y + h, z: Math.floor(mid.z + side.z * s) });
  return cells;
}

register({
  id: "vigil",
  tier: 3,
  minStage: 1,
  needsBody: true,
  cooldown: 0,
  manual: true,
  weight: () => 1,
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    // same threshold as the Field Notes' eligibility check
    const h = primaryHaunt(p, 120);
    const home = h ? h.center : p.location;
    enc.restoreDelay = 3;
    let rained = false;
    if (S().worldEffects && enc.dimId === "minecraft:overworld") {
      safe(() => dim.setWeather(WeatherType.Rain, 20 * 60 * 4));
      rained = true;
      for (const o of allPlayers()) safe(() => o.sendMessage({ rawtext: [{ translate: "observer.msg.vigil_weather" }] }));
    }
    enc.fog("vigil");
    safe(() => p.onScreenDisplay.setTitle({ rawtext: [{ translate: "observer.ui.vigil_title" }] }, { fadeInDuration: 20, stayDuration: 40, fadeOutDuration: 20, subtitle: { rawtext: [{ translate: "observer.ui.vigil_sub" }] } }));
    await enc.wait(80);
    let wins = 0;
    for (let round = 0; round < 3; round++) {
      enc.sound(SOUNDS.vigil, home, 0.8);
      // the grounds shift
      for (const l of litLightsNear(dim, p.location, 16, 3)) enc.snuff(l);
      const door = findBlocks(dim, home, 12, 3, OPENABLE, 6)[round];
      if (door) enc.toggle(door);
      const spot = findSpot(p, { origin: home, minDist: 8, maxDist: 24, concealment: "hidden", watchLOSIgnoringView: true, samples: 30 })
        ?? findSpot(p, { minDist: 12, maxDist: 26, concealment: "hidden", samples: 30 });
      if (!spot) {
        enc.log("no hiding place this round; skipping");
        wins++;
        continue;
      }
      if (round > 0) enc.veil(screenBetween(dim, p.location, spot.loc));
      enc.data.lensed = false;
      enc.spawnBody(spot.loc, { state: round === 2 ? "stare" : "watch", stoop: spot.stoop, side: spot.side });
      await enc.wait(10);
      enc.sound(SOUNDS.tell, { x: spot.loc.x, y: spot.loc.y + 2, z: spot.loc.z }, 1, 1, "caption.chime");
      let found = false;
      enc.gaze.seenTicks = 0;
      for (let t = 0; t < 20 * 60; t += 2) {
        await enc.wait(2);
        enc.updateGaze([p]);
        if (enc.data.lensed || enc.gaze.seenTicks >= 60) {
          found = true;
          break;
        }
        if (t > 0 && t % 300 === 0) enc.sound(SOUNDS.tell, { x: spot.loc.x, y: spot.loc.y + 2, z: spot.loc.z }, 0.7, 0.9);
      }
      if (!found) {
        // it is behind you
        const behind = findSpot(p, { minDist: 2.6, maxDist: 4, bearings: [180], spread: 25, concealment: "hidden" });
        if (behind) body.moveTo(behind.loc, p.getHeadLocation());
        enc.sound(SOUNDS.breath, p.location, 0.9, 1, "caption.breath");
        await enc.wait(30);
        enc.fade(0.3, 1.6, 1.5);
        await enc.wait(20);
        body.despawn("vigil_failed");
        enc.s.vigilTries++;
        markPlayerDirty(p);
        safe(() => p.sendMessage({ rawtext: [{ translate: "observer.msg.vigil_failed" }] }));
        enc.result("failed", true);
        if (rained) safe(() => dim.setWeather(WeatherType.Clear, 20 * 60));
        return;
      }
      wins++;
      body.setState("tilt");
      enc.sound(SOUNDS.lens, body.loc() ?? spot.loc, 0.8);
      await enc.wait(30);
      body.despawn("round_done");
      await enc.wait(120);
    }
    // ---- witnessed
    const last = findSpot(p, { minDist: 7, maxDist: 10, bearings: [0], spread: 30, concealment: "visible", needLOS: true, samples: 24 });
    if (last) {
      enc.spawnBody(last.loc, { state: "stare", stoop: last.stoop });
      await enc.until(() => visibility(p, last.loc, { fov: 40 }).points > 0, 200, 4);
      body.setState("tilt");
      await enc.wait(70);
      await body.withdraw([p], 100);
    }
    enc.s.witnessed = true;
    enc.s.endMode = enc.s.endMode || "attendant";
    markPlayerDirty(p);
    enc.result("witnessed", true);
    give(p, ITEMS.eye, 1);
    safe(() => p.onScreenDisplay.setTitle({ rawtext: [{ translate: "observer.ui.witnessed_title" }] }, { fadeInDuration: 30, stayDuration: 80, fadeOutDuration: 40, subtitle: { rawtext: [{ translate: "observer.ui.witnessed_sub" }] } }));
    safe(() => p.sendMessage({ rawtext: [{ translate: "observer.msg.witnessed" }] }));
    if (rained) safe(() => dim.setWeather(WeatherType.Clear, 20 * 60 * 5));
    enc.log(`${p.name} witnessed after ${wins} rounds`);
  },
});
