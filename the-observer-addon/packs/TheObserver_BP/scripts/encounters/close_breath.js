// @ts-check
// E12 "Close" — contact without an attack. When the player stays in one place for a while
// (crafting, mining, reading the map), it comes to stand right behind them, out of view. Cloth
// shifts; a slow exhale. If they turn, it is there for a moment, head tilted, then gone. If they
// never turn, it leans in, and leaves something where it stood.
// With sudden scares off it stays several blocks back, and there is no sting or camera effect.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS } from "../core/constants.js";
import { V, rand, chance } from "../core/util.js";
import { S } from "../core/settings.js";
import { findSpot } from "../world/space.js";
import { visibility } from "../world/sight.js";
import { effigyCell } from "../world/manipulate.js";
import { sighting, trailAway } from "./common.js";

register({
  id: "close_breath",
  tier: 3,
  minStage: 3,
  needsBody: true,
  cooldown: 1200,
  weight(c) {
    if (c.water || c.gliding || c.stillFor < 6) return 0;
    return 9;
  },
  prepare(enc) {
    const p = enc.p;
    const gentle = S().scares === 0;
    const spot = findSpot(p, {
      minDist: gentle ? 8 : 2.6, maxDist: gentle ? 11 : 4, bearings: [180], spread: 30,
      concealment: "hidden", watchLOSIgnoringView: true, hideFrom: enc.witnesses(), samples: 20,
    });
    if (!spot) return false;
    enc.data.spot = spot;
    enc.data.gentle = gentle;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const { spot, gentle } = enc.data;
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop })) return enc.result("deferred");
    enc.sound(SOUNDS.fabric, spot.loc, 0.55, 1, "caption.cloth");
    await enc.wait(36);
    enc.sound(SOUNDS.breath, { x: spot.loc.x, y: spot.loc.y + 2.5, z: spot.loc.z }, gentle ? 0.45 : 0.75, 1, "caption.breath");
    let faced = false;
    for (let t = 0; t < 20 * 7 && !faced; t += 2) {
      await enc.wait(2);
      const b = body.get();
      if (!b) return;
      faced = visibility(p, b.e.location, { stooped: b.stoop, fov: 50 }).points > 0;
      if (!faced && V.dist(p.location, spot.loc) > 9) break; // walked off
    }
    if (faced) {
      sighting(enc, p);
      enc.discover("close");
      if (!gentle && enc.canScare()) {
        enc.usedScare();
        enc.sound(SOUNDS.sting, body.loc() ?? spot.loc, 0.85);
        enc.shake(0.3, 0.5);
      }
      body.setState("tilt");
      await enc.wait(Math.round(rand(20, 30)));
      if (!gentle && enc.fade(0.2, 0.6, 1.0)) {
        await enc.wait(5);
        body.despawn("faded");
      }
      enc.discover("held_gaze");
      enc.result("faced", true);
      return;
    }
    // never turned: it leans in, then leaves something
    body.setState("peek");
    await enc.wait(30);
    enc.result("unaware");
    const l = body.loc() ?? spot.loc;
    body.despawn("left");
    enc.leaveTrace(trailAway(enc.dim, l, p.location, 6));
    if (enc.s.stage >= 3 && chance(0.6)) {
      const cell = effigyCell(enc.dim, l, 1);
      if (cell) enc.effigy(cell, p.location);
    }
  },
});
