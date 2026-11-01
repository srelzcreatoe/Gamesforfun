// @ts-check
// E30 "One of Them" (1.3.0) — it wears them. Among a few of the creatures that answer to it, out ahead of you, one is
// not what it seems: it moves with the others, it looks like the others — only its eyes, if you look closely, are its.
// Come close to that one (within six blocks), or look straight at it for a moment, and it comes apart, and it is
// standing there among them. Leave them be and you never knew. It does not stop the others being what they are.
// From the third stage; needs two or more of them together, 12-32 blocks off, in sight.
import { register } from "../director/director.js";
import * as puppets from "../observer/puppets.js";
import { standing, isHeld } from "../observer/dominion.js";
import { V, safe } from "../core/util.js";
import { S } from "../core/settings.js";
import { standNear } from "../world/space.js";
import { lineOfSight, viewAngle } from "../world/sight.js";
import { sighting } from "./common.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

/** One of a group (two or more within six blocks of each other), 12-32 blocks off, in sight. @param {Player} p */
function group(p) {
  if (!S().enabled || S().puppets === false) return undefined;
  const eye = p.getHeadLocation();
  const kin = (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 32, families: ["monster"] }), []) ?? [])
    .filter((e) => standing(e) === "kin" && !isHeld(e.id) && !puppets.isPuppet(e) && V.dist(e.location, p.location) >= 12);
  for (const e of kin) {
    const mates = kin.filter((o) => o.id !== e.id && V.dist(o.location, e.location) <= 6);
    if (!mates.length) continue;
    const head = safe(() => e.getHeadLocation(), e.location) ?? e.location;
    if (lineOfSight(p.dimension, eye, head).clear) return e;
  }
  return undefined;
}

register({
  id: "among_them",
  tier: 2,
  minStage: 3,
  needsBody: true,
  cooldown: 900,
  reactNear: false,
  weight(c) {
    if (c.water || c.gliding) return 0;
    return group(c.p) ? 4 : 0;
  },
  prepare(enc) {
    const e = group(enc.p);
    if (!e) return false;
    enc.data.e = e;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {Entity} */
    const e = enc.data.e;
    // it moves with the others; only its eyes are its (no wisps, no shreds: it is not to stand out)
    const pp = puppets.take(e, "among", { p, mode: "free", quiet: true, seconds: 60 });
    if (!pp) return enc.result("deferred");
    enc.emit("among", { what: "worn", type: e.typeId });
    let looked = 0, found = false;
    for (let t = 0; t < 20 * 45 && pp.e.isValid && !found; t += 2) {
      await enc.wait(2);
      const head = safe(() => pp.e.getHeadLocation(), pp.e.location) ?? pp.e.location;
      const d = V.dist(pp.e.location, p.location);
      looked = d <= 20 && viewAngle(p, head) < 10 && lineOfSight(enc.dim, p.getHeadLocation(), head).clear ? looked + 2 : 0;
      found = d < 6 || looked >= 30;
    }
    if (!found || !pp.e.isValid) {
      if (puppets.get(pp.id)) puppets.release(pp.id, "quiet");
      enc.emit("among", { what: "unnoticed" });
      return enc.result("unnoticed");
    }
    // found out: it comes apart, and it is standing there among them
    const at = { ...pp.e.location };
    puppets.release(pp.id, "torn");
    const st = standNear(enc.dim, at.x, at.z, at.y);
    if (st && enc.spawnBody(st.loc, { state: "stare", stoop: st.stoop, silent: true, autoPeek: false })) {
      enc.emit("among", { what: "it_was_it" });
      sighting(enc, p);
      await enc.wait(40);
    }
    enc.result("found_out", true);
    enc.discover("one_of_them");
  },
});
