// @ts-check
// E7 "The Door" — a door, trapdoor or gate nearby changes state while the player looks away,
// with the matching sound from exactly there. Closing it again is the right answer: a single
// knock answers from the other side. From stage 4 it can be seen beyond the doorway as the player
// comes to close it.
import { register, activeEncounter } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS, DOORS } from "../core/constants.js";
import { V, safe, randInt } from "../core/util.js";
import { findBlocks, OPENABLE } from "../world/manipulate.js";
import { viewAngle } from "../world/sight.js";
import { findSpot } from "../world/space.js";
import { sighting, acknowledge } from "./common.js";

register({
  id: "door_ajar",
  tier: 1,
  minStage: 1,
  needsBody: false,
  minManip: 1,
  cooldown: 420,
  benign: true,
  weight(c) {
    if (c.water || c.gliding) return 0;
    return c.sheltered || c.hauntDist < 32 ? 10 : 6;
  },
  prepare(enc) {
    const p = enc.p;
    const doors = findBlocks(enc.dim, p.location, 16, 4, OPENABLE, 16).filter((d) => {
      const c = { x: d.x + 0.5, y: d.y + 1, z: d.z + 0.5 };
      return V.dist(c, p.location) > 4 && viewAngle(p, c) > 80;
    });
    if (doors.length === 0) return false;
    enc.data.door = doors[0];
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const d = enc.data.door;
    const c = { x: d.x + 0.5, y: d.y + 1, z: d.z + 0.5 };
    const typeId = safe(() => enc.dim.getBlock(d)?.typeId) ?? "";
    const open = enc.toggle(d, 5 * 60);
    if (open === undefined) return enc.result("blocked");
    const isDoor = DOORS.has(typeId);
    enc.sound(open ? (isDoor ? "random.door_open" : "random.wood_click") : (isDoor ? "random.door_close" : "random.wood_click"), c, 0.9, 0.9, "caption.door_nearby");
    enc.log(`door ${V.str(d)} open=${open}`);
    let looked = false;
    let shown = false;
    for (let t = 0; t < 20 * 50; t += 4) {
      await enc.wait(4);
      if (!looked && viewAngle(p, c) < 18 && V.dist(p.location, c) < 14) {
        looked = true;
        enc.result("looked", true);
      }
      // stage 4+: as they come to deal with it, it is standing beyond the doorway
      if (!shown && open && enc.s.stage >= 4 && V.dist(p.location, c) < 5 && !activeEncounter() && !body.exists()) {
        shown = true;
        const away = V.flat(V.sub(c, p.location));
        const spot = findSpot(p, { origin: V.add(c, V.scale(away, 9)), minDist: 0, maxDist: 3, concealment: "any", needLOS: true, samples: 10 });
        if (spot) {
          enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop });
          enc.data.bodyShown = true;
        }
      }
      if (enc.ownsBody()) {
        enc.updateGaze();
        if (enc.gaze.seenTicks >= 6) {
          sighting(enc, enc.gaze.lastWatcher ?? p);
          await acknowledge(enc, 6, 14);
          body.despawn("doorway");
        }
      }
      const r = enc.released.find((x) => x.how === "player_restored" || x.how === "player_changed");
      if (r) {
        enc.result("closed_it", true);
        enc.discover("the_door");
        await enc.wait(randInt(40, 70));
        enc.sound(SOUNDS.knock, V.add(c, V.scale(V.flat(V.sub(c, p.location)), 1.2)), 0.7, 1, "caption.knock");
        break;
      }
    }
    if (enc.ownsBody()) body.despawn("doorway_end");
    if (!enc.noticed) enc.result("unnoticed");
  },
});
