// @ts-check
// E5 "Borrowed Work" — the sound of the player's own habit (mining, chopping, doors, chests...)
// coming from somewhere nobody is: the last place they did it, or a spot they passed earlier.
// From stage 2 the Observer stands there. Going to look stops the sound; it is gone, but its
// footprints (and sometimes an effigy) are left behind.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { BORROWED, SOUNDS } from "../core/constants.js";
import { V, pick, randInt, rand, dimIndex, chance } from "../core/util.js";
import { dominantHabit } from "../observer/memory.js";
import { findSpot } from "../world/space.js";
import { visibility } from "../world/sight.js";
import { sighting, trailAway, acknowledge } from "./common.js";
import { effigyCell } from "../world/manipulate.js";

register({
  id: "borrowed_sound",
  tier: 1,
  minStage: 1,
  needsBody: true,
  cooldown: 420,
  benign: true,
  weight(c) {
    if (c.water || c.gliding) return 0;
    return c.moving ? 7 : 11;
  },
  prepare(enc) {
    const p = enc.p;
    const s = enc.s;
    const habit = dominantHabit(p, Object.keys(BORROWED)) ?? (enc.ctx.underground ? "mine" : "dig");
    const d = dimIndex(enc.dimId);
    /** candidate sources: where the habit last happened, then older crumbs */
    const cands = [];
    const la = s.lastAct[habit];
    if (la && la[0] === d) cands.push({ x: la[1] + 0.5, y: la[2], z: la[3] + 0.5 });
    for (const c of s.crumbs.slice().reverse()) if (c[0] === d) cands.push({ x: c[1] + 0.5, y: c[2], z: c[3] + 0.5 });
    const src = cands.find((c) => {
      const dist = V.dist(c, p.location);
      return dist > 14 && dist < 40 && visibility(p, c, { fov: 70 }).points === 0;
    });
    if (!src) return false;
    enc.data.habit = habit;
    enc.data.src = src;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const { habit, src } = enc.data;
    const spec = BORROWED[habit];
    if (enc.s.stage >= 2) {
      const spot = findSpot(p, { origin: src, minDist: 0.5, maxDist: 3, concealment: "hidden", samples: 12, hideFrom: enc.witnesses() });
      if (spot) enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop });
    }
    enc.log(`habit=${habit} src=${V.str(src)}`);
    enc.emit("info", { habit, x: src.x, y: src.y, z: src.z });
    const reps = randInt(spec.reps[0], spec.reps[1]);
    let investigated = false;
    for (let i = 0; i < reps * 2 && !investigated; i++) {
      const burst = randInt(2, 4);
      for (let k = 0; k < burst; k++) {
        enc.sound(pick(spec.sounds), src, 0.75, rand(0.92, 1.05), i === 0 && k === 0 ? spec.caption : undefined);
        await enc.wait(randInt(spec.beat[0], spec.beat[1]));
      }
      await enc.wait(randInt(16, 40));
      investigated = V.dist(p.location, src) < 11;
      if (body.get()) {
        enc.updateGaze();
        if (enc.gaze.seenTicks >= 10) break;
      }
    }
    // go and look: wait up to 40 s for them to come within 10 blocks
    if (!investigated) investigated = await enc.until(() => V.dist(p.location, src) < 10, 20 * 40, 10);
    if (enc.gaze.seenTicks >= 10) {
      sighting(enc, enc.gaze.lastWatcher ?? p);
      await acknowledge(enc, 8, 12);
    }
    const bl = body.loc() ?? src;
    if (body.get() && !body.visibleTo(enc.watchers())) body.despawn("left");
    if (investigated) {
      enc.result("investigated", true);
      enc.discover("borrowed_work");
      enc.footprints(trailAway(enc.dim, bl, p.location, 8));
      enc.leaveTrace(trailAway(enc.dim, bl, p.location, 8));
      if (enc.s.stage >= 3 && chance(0.4)) {
        const cell = effigyCell(enc.dim, bl, 2);
        if (cell) enc.effigy(cell, p.location);
      }
      enc.sound(SOUNDS.fabric, bl, 0.35);
    } else enc.result("ignored");
  },
});
