// @ts-check
// E31 "The Mirror" (1.4.0). Out ahead of you, a creature moves like your reflection. You step sideways, and it steps
// the same way; you walk toward it, and it walks toward you; you stop, and it stops; you jump, and it jumps. It faces
// you as your reflection would — turn to it and it turns to you. Walk all the way up to it and it stops, stares, and
// the possession is torn out of it: the creature is itself again. Keep your distance and in a while it simply stops,
// as if it never had.
// From the second stage; needs a creature (one that answers to it, a farm animal, a villager) 10-22 blocks off, ahead
// of you, in sight; not underground or in water.
import { register } from "../director/director.js";
import * as puppets from "../observer/puppets.js";
import { standing, isHeld } from "../observer/dominion.js";
import { V, safe } from "../core/util.js";
import { S } from "../core/settings.js";
import { lineOfSight } from "../world/sight.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

const KINDS = /^minecraft:(cow|mooshroom|sheep|pig|chicken|goat|villager_v2|horse|donkey|mule|llama|fox|rabbit|panda|polar_bear)$/;

/** A creature ahead of them, 10-22 blocks off, in sight. @param {Player} p */
function candidate(p) {
  if (!S().enabled || S().puppets === false) return undefined;
  const eye = p.getHeadLocation();
  const view = V.fromYaw(safe(() => p.getRotation().y, 0) ?? 0);
  const marks = S().marks ?? {};
  return (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 22, excludeTypes: ["minecraft:player", "minecraft:item"] }), []) ?? [])
    .filter((e) => !e.typeId.startsWith("observer:") && !puppets.isPuppet(e) && !isHeld(e.id) && !safe(() => e.nameTag, "")
      && !safe(() => e.hasComponent("minecraft:is_tamed"), false) && marks[e.typeId] !== "ignore"
      && (standing(e) === "kin" || KINDS.test(e.typeId) || marks[e.typeId] === "puppet") && V.hdist(e.location, p.location) >= 10)
    .find((e) => {
      const head = safe(() => e.getHeadLocation(), e.location) ?? e.location;
      return V.angle(view, V.flat(V.sub(head, eye))) < 50 && lineOfSight(p.dimension, eye, head).clear;
    });
}

register({
  id: "mirrored",
  tier: 1,
  minStage: 2,
  needsBody: false,
  cooldown: 1500,
  reactNear: false,
  weight(c) {
    if (c.water || c.gliding || c.underground || c.d !== 0) return 0;
    return candidate(c.p) ? 3 : 0;
  },
  prepare(enc) {
    const e = candidate(enc.p);
    if (!e) return false;
    enc.data.e = e;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {Entity} */
    const e = enc.data.e;
    const pp = puppets.take(e, "mirror", { p, mode: "mirror", seconds: 60 });
    if (!pp) return enc.result("deferred");
    enc.emit("mirror", { what: "begin", type: e.typeId, d: Math.round(V.hdist(e.location, p.location)) });
    let looked = 0, copied = 0, found = false;
    for (let t = 0; t < 20 * 40 && puppets.get(pp.id) === pp; t += 2) {
      await enc.wait(2);
      if (pp.looked) looked += 2;
      if (pp.moving) copied += 2;
      if (V.hdist(p.location, pp.e.location) < 6.5) {
        found = true;
        break;
      }
    }
    if (puppets.get(pp.id) !== pp) return enc.result("lost");
    if (found) {
      // it stops; it stares at them; and the possession is torn out of it
      puppets.setMode(pp, "stand");
      enc.emit("mirror", { what: "found", looked, copied });
      await enc.wait(24);
      puppets.release(pp.id, "torn_out");
      enc.result("found_out", true);
      enc.discover("the_mirror");
      return;
    }
    puppets.release(pp.id, "quiet");
    enc.emit("mirror", { what: "end", looked, copied });
    if (looked >= 40 && copied >= 20) {
      enc.result("noticed", true);
      enc.discover("the_mirror");
    } else enc.result("unnoticed");
  },
});
