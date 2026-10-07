// @ts-check
// E3 SIGNATURE "Someone Was Home"
// Memory + manipulation: when the player heads back to the place they spend the most time
// (bed / most-visited 16x16 cell), the Observer gets there first. It leaves a small, deliberate
// arrangement — a door in the wrong state, the lights nearest the entrance out, an object turned
// toward the way they come in, and an effigy of itself — then watches from outside.
// Player choices:
//   put something back (close the door, relight, turn it back) -> "Put Back": it acknowledges and
//                                                                 restores the rest itself
//   break the effigy                                            -> a Vestige ("Small Likeness")
//   look at what changed / spot it watching                     -> "Someone Was Home"
//   ignore it                                                   -> it stays changed for a while (tension rises)
// With manipulation off, only sound cues and footprints are used.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS, TURNABLE } from "../core/constants.js";
import { V, safe, rand } from "../core/util.js";
import { now } from "../core/state.js";
import { findBlocks, OPENABLE, litLightsNear, effigyCell, manip } from "../world/manipulate.js";
import { findSpot, loaded, isWarded } from "../world/space.js";
import { lineOfSight } from "../world/sight.js";
import { sighting, acknowledge, trailBetween } from "./common.js";
import { dimIndex } from "../core/util.js";

register({
  id: "home_visit",
  tier: 2,
  minStage: 2,
  needsBody: true,
  cooldown: 1800,
  weight(c) {
    if (!c.haunt || c.water || c.gliding) return 0;
    if (c.hauntDist < 40 || c.hauntDist > 96) return 0;
    if (now() - c.haunt.lastVisit < 240) return 0;
    return 16;
  },
  prepare(enc) {
    const h = enc.ctx.haunt;
    if (!h || !loaded(enc.dim, h.center) || isWarded(dimIndex(enc.dimId), h.center)) return false;
    enc.data.center = h.center;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    const center = enc.data.center;
    const approachFrom = p.location;
    /** @type {{kind:string, loc:any}[]} */
    const changed = [];

    // ---- staging while the player is still far away
    if (manip() >= 1) {
      const doors = findBlocks(dim, center, 10, 4, OPENABLE, 8)
        .sort((a, b) => V.dist(a, approachFrom) - V.dist(b, approachFrom));
      for (const d of doors.slice(0, 2)) {
        if (enc.toggle(d) !== undefined) {
          changed.push({ kind: "door", loc: d });
          break;
        }
      }
      const lights = litLightsNear(dim, center, 10, 10).sort((a, b) => V.dist(a, approachFrom) - V.dist(b, approachFrom));
      let snuffed = 0;
      for (const l of lights) {
        if (snuffed >= 3) break;
        if (enc.snuff(l)) {
          changed.push({ kind: "light", loc: l });
          snuffed++;
        }
      }
      const turnables = findBlocks(dim, center, 10, 4, TURNABLE, 6);
      for (const tb of turnables) {
        if (enc.turn(tb, approachFrom)) {
          changed.push({ kind: "turn", loc: tb });
          break;
        }
      }
      const cell = effigyCell(dim, center, 3);
      if (cell && enc.effigy(cell, approachFrom)) changed.push({ kind: "effigy", loc: cell });
    }
    enc.log(`staged ${changed.map((c) => c.kind).join(",") || "nothing (sound only)"}`);
    const door = changed.find((c) => c.kind === "door");
    if (door) enc.leaveTrace(trailBetween(dim, door.loc, center));

    // ---- it waits outside, facing the house
    const spot = findSpot(p, {
      origin: center, minDist: 14, maxDist: 24, concealment: "any", losTarget: { x: center.x, y: center.y + 1.5, z: center.z },
      hideFrom: enc.watchers(), samples: 26,
    });
    if (spot) enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop, side: spot.side, face: center });
    if (body.get()) body.get().faceTarget = false;

    // ---- wait for the player to come home
    const arrived = await enc.until(() => V.hdist(p.location, center) < 22, 20 * 90, 10);
    if (!arrived) {
      enc.restoreDelay = 120;
      return enc.result("never_came");
    }
    if (door) enc.sound("random.door_open", door.loc, 0.8, 0.85, "caption.door_inside");
    else if (changed.length === 0) enc.sound(SOUNDS.knock, center, 0.7, 1, "caption.knock");
    if (body.get()) body.get().faceTarget = true;

    // ---- response window
    let lookTicks = 0;
    let restored = 0;
    let acknowledged = false;
    for (let t = 0; t < 20 * 180; t += 4) {
      await enc.wait(4);
      if (V.hdist(p.location, center) > 64) break;
      for (const r of enc.released.splice(0)) {
        if (r.player && r.player.id === p.id && (r.how === "player_restored" || r.how === "player_changed") && r.kind !== "effigy") restored++;
        if (r.kind === "effigy" && r.how === "broken") enc.result("effigy_broken", true);
      }
      if (restored > 0 && !acknowledged) {
        acknowledged = true;
        enc.result("put_back", true);
        enc.discover("put_back");
        enc.restoreDelay = 30;
        if (body.get() && body.watchedBy([p], 60)) await acknowledge(enc, 8, 24);
        body.despawn("acknowledged");
      }
      // looking at one of its changes from close by
      for (const c of changed) {
        const target = { x: c.loc.x + 0.5, y: c.loc.y + 0.5, z: c.loc.z + 0.5 };
        if (V.dist(p.getHeadLocation(), target) < 10 && V.angle(p.getViewDirection(), V.sub(target, p.getHeadLocation())) < 14
          && lineOfSight(dim, p.getHeadLocation(), target).clear) lookTicks += 4;
      }
      if (lookTicks >= 20 && !enc.noticed) {
        enc.result("noticed_changes", true);
        enc.discover("someone_was_home");
      }
      if (body.get()) {
        enc.updateGaze();
        if (enc.gaze.seenTicks >= 14) {
          sighting(enc, enc.gaze.lastWatcher ?? p);
          enc.discover("someone_was_home");
          await acknowledge(enc, 10, 20);
          await body.withdraw(enc.watchers(), 120);
        } else if (V.dist(p.location, body.loc() ?? p.location) < 12) await body.withdraw(enc.watchers(), 120);
      }
      if (acknowledged && t > 600) break;
    }
    if (!enc.noticed) {
      enc.result("ignored");
      enc.restoreDelay = 480;
    } else if (!acknowledged) enc.restoreDelay = 240;
  },
});
