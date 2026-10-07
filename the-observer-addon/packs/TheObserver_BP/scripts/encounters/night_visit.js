// @ts-check
// E16 "While You Slept" — triggered when a player sleeps (not chosen by the timer).
// While they sleep it comes in: the nearest door is left open, a light near the bed goes out, and
// an effigy stands at the foot of the bed facing it. A trail of footprints runs from the door to
// the bed. On waking, a creak from the door. Closing the door or breaking the effigy is noticed.
import { register } from "../director/director.js";
import { SOUNDS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { findBlocks, OPENABLE, litLightsNear, effigyCell, manip } from "../world/manipulate.js";
import { trailBetween } from "./common.js";

register({
  id: "night_visit",
  tier: 2,
  minStage: 2,
  needsBody: false,
  minManip: 1,
  cooldown: 2400,
  manual: true,
  weight: () => 1,
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    const bed = p.location;
    const changed = [];
    const doors = findBlocks(dim, bed, 12, 3, OPENABLE, 6);
    let door;
    for (const d of doors) {
      const b = safe(() => dim.getBlock(d));
      if (b && !b.permutation.getState("open_bit") && enc.toggle(d, 10 * 60) !== undefined) {
        door = d;
        changed.push(d);
        break;
      }
    }
    if (manip() >= 2) {
      const l = litLightsNear(dim, bed, 6, 3)[0];
      if (l && enc.snuff(l, 10 * 60)) changed.push(l);
    }
    const cell = effigyCell(dim, bed, 2);
    if (cell && enc.effigy(cell, bed)) changed.push(cell);
    if (changed.length === 0) return enc.result("nothing_to_do");
    if (door) enc.leaveTrace(trailBetween(dim, door, bed));
    enc.log(`staged ${changed.length} changes while ${p.name} slept`);
    // wait for them to wake
    const woke = await enc.until(() => !p.isSleeping, 20 * 60, 10);
    if (!woke) return enc.result("slept_through");
    await enc.wait(40);
    if (door) enc.sound("random.door_open", { x: door.x + 0.5, y: door.y + 1, z: door.z + 0.5 }, 0.6, 0.8, "caption.door_nearby");
    for (let t = 0; t < 20 * 120; t += 10) {
      await enc.wait(10);
      if (enc.released.some((r) => r.player && r.player.id === p.id)) {
        enc.result("answered", true);
        enc.discover("while_you_slept");
        break;
      }
    }
    if (!enc.noticed) enc.result("ignored");
    enc.restoreDelay = 5 * 60;
  },
});
