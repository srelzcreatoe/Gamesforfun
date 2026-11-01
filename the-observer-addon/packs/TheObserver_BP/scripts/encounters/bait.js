// @ts-check
// E29 "Bait" (1.3.0). At night, someone cries out from the dark: a villager, hurt, calling — from somewhere it should
// not be, off in the dark. It is one of its: put there unseen, its eyes in it, and it calls, and calls. Go to it and,
// as you come close, it turns to look at you — and it is standing right behind it, in the dark, waiting. Then it is
// gone, and the villager is back where it came from, unharmed, as if nothing happened. Do not go, and the calling
// stops. It never hurts you; the villager is never harmed.
// From the third stage; needs a villager within 48 blocks and a dark place (light 7 or less) 14-26 blocks from you.
import { register } from "../director/director.js";
import * as puppets from "../observer/puppets.js";
import * as body from "../observer/body.js";
import { V, safe } from "../core/util.js";
import { S } from "../core/settings.js";
import { findSpot, standNear } from "../world/space.js";
import { sighting } from "./common.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** A villager to use, not anyone's. @param {Player} p */
function villager(p) {
  if (!S().enabled || S().puppets === false) return undefined;
  return (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 48, type: "minecraft:villager_v2" }), []) ?? [])
    .find((e) => !e.nameTag && !puppets.isPuppet(e));
}

register({
  id: "bait",
  tier: 2,
  minStage: 3,
  needsBody: true,
  cooldown: 1800,
  reactNear: false,
  weight(c) {
    if (c.d !== 0 || !(c.night || c.light <= 7) || c.water) return 0;
    return villager(c.p) ? 4 : 0;
  },
  prepare(enc) {
    const p = enc.p;
    const v = villager(p);
    if (!v) return false;
    // somewhere dark, off to one side or behind, that nobody can see right now
    const dim = enc.dim;
    let spot;
    for (let i = 0; i < 4 && !spot; i++) {
      const s = findSpot(p, { minDist: 14, maxDist: 26, bearings: [90, -90, 150, -150], spread: 35, concealment: "hidden", watchLOSIgnoringView: true, yMode: "near", samples: 40 });
      if (s && (safe(() => dim.getLightLevel({ x: s.loc.x, y: s.loc.y + 1, z: s.loc.z }), 15) ?? 15) <= 7) spot = s;
    }
    if (!spot) return false;
    enc.data.v = v;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const v = enc.data.v;
    const spot = enc.data.spot;
    const pp = puppets.take(v, "bait", { p, mode: "stand", seconds: 90, home: true });
    if (!pp) return enc.result("deferred");
    if (!puppets.place(pp, spot.loc, p.getHeadLocation())) {
      puppets.release(pp.id, "home");
      return enc.result("deferred");
    }
    enc.emit("bait", { what: "placed", x: spot.loc.x, y: spot.loc.y, z: spot.loc.z });
    // it calls out, hurt, again and again
    let near = false;
    for (let t = 0; t < 20 * 45 && !near && pp.e.isValid; t += 5) {
      if (t % 60 === 0) {
        enc.worldSound(t % 120 === 0 ? "mob.villager.hit" : "mob.villager.no", pp.e.location, 0.9, 0.85 + Math.random() * 0.1);
        enc.caption("caption.bait");
        enc.emit("bait", { what: "call" });
      }
      await enc.wait(5);
      near = V.dist(p.location, pp.e.location) < 7;
    }
    if (!near) {
      if (puppets.get(pp.id)) puppets.release(pp.id, "home");
      enc.emit("bait", { what: "ignored" });
      return enc.result("ignored");
    }
    // close: it turns to them — and it is standing right behind it, in the dark
    const away = V.flat(V.sub(pp.e.location, p.location));
    const want = V.add(pp.e.location, V.scale(away, 2.2));
    const st = standNear(enc.dim, want.x, want.z, pp.e.location.y);
    if (st) {
      enc.spawnBody(st.loc, { state: "stare", stoop: st.stoop, silent: true, autoPeek: false });
      body.faceTo(p.getHeadLocation());
      enc.emit("bait", { what: "behind_it" });
      sighting(enc, p);
    }
    await enc.wait(40);
    if (puppets.get(pp.id)) puppets.release(pp.id, "home");
    enc.result("lured", true);
    enc.discover("the_voice_in_the_dark");
  },
});
