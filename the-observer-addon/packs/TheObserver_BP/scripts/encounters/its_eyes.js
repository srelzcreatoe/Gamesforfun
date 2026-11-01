// @ts-check
// E27 "Its Eyes" (1.2.1). A creature of the dark that answers to it — a zombie, a spider, another add-on's creature —
// stops what it is doing and stares at you, perfectly still, its eyes gone cold and bright like its. It is its eyes.
// Look at it, and it comes apart where it stands — and it is standing there in its place, looking at you. Do not
// look, and after a while it lets the creature go back to what it was doing, and you never knew. It never hurts you.
// From the second stage; it needs a creature that answers to it 8-28 blocks away, in front of you and in sight.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { standing, isHeld, tearApart, eyes, harmless } from "../observer/dominion.js";
import { S } from "../core/settings.js";
import { V, safe } from "../core/util.js";
import { standNear } from "../world/space.js";
import { lineOfSight, viewAngle } from "../world/sight.js";
import { sighting } from "./common.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

/** A creature that answers to it, 8-28 blocks off, in front of the player and in their sight. @param {Player} p */
export function eyesFor(p) {
  if (!S().enabled || S().creatures === false) return undefined;
  const eye = p.getHeadLocation();
  const near = safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 28, families: ["monster"] }), []) ?? [];
  return near
    .filter((e) => {
      const d = V.dist(e.location, p.location);
      if (d < 8 || isHeld(e.id) || standing(e) !== "kin") return false;
      const head = safe(() => e.getHeadLocation(), e.location) ?? e.location;
      return viewAngle(p, head) < 70 && lineOfSight(p.dimension, eye, head).clear;
    })
    .sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location))[0];
}

register({
  id: "its_eyes",
  tier: 2,
  minStage: 2,
  needsBody: true,
  cooldown: 900,
  reactNear: false,
  weight(c) {
    if (c.d !== 0 && c.d !== 1) return 0;
    return eyesFor(c.p) ? (c.night || c.light <= 7 ? 6 : 3) : 0;
  },
  prepare(enc) {
    const e = eyesFor(enc.p);
    if (!e) {
      const p = enc.p;
      const near = safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 28, families: ["monster"] }), []) ?? [];
      enc.emit("eyes", { what: "none", near: near.map((x) => {
        const head = safe(() => x.getHeadLocation(), x.location) ?? x.location;
        return [x.typeId, Math.round(V.dist(x.location, p.location)), isHeld(x.id), standing(x), Math.round(viewAngle(p, head)), lineOfSight(p.dimension, p.getHeadLocation(), head).clear];
      }) });
      return false;
    }
    enc.data.host = e;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {Entity} */
    const e = enc.data.host;
    enc.emit("eyes", { what: "stare", type: e.typeId });
    // it stops, turns to them, and stares, still and harmless, its eyes in it
    let looked = 0;
    for (let t = 0; t < 20 * 14; t += 2) {
      await enc.wait(2);
      if (!e.isValid) return enc.result("host_gone");
      const head = safe(() => e.getHeadLocation(), e.location) ?? e.location;
      const eye = p.getHeadLocation();
      safe(() => e.setRotation({ x: V.pitchTo(head, eye), y: V.yawTo(e.location, p.location) }));
      if (t % 10 === 0) {
        safe(() => e.addEffect("slowness", 30, { amplifier: 7, showParticles: false }));
        harmless(e);
        eyes(e);
      }
      const v = safe(() => e.getVelocity(), undefined);
      if (v && (v.x || v.z)) safe(() => e.applyImpulse({ x: -v.x, y: 0, z: -v.z }));
      looked = viewAngle(p, head) < 12 && lineOfSight(enc.dim, eye, head).clear ? looked + 2 : 0;
      if (looked >= 10) break;
    }
    if (looked < 10) {
      // they never looked: it lets the creature go back to what it was doing, and they never knew
      safe(() => e.removeEffect("slowness"));
      safe(() => e.removeEffect("weakness"));
      enc.emit("eyes", { what: "unnoticed" });
      return enc.result("unnoticed");
    }
    // they looked: it comes apart — and it is standing there
    const at = { ...e.location };
    const st = standNear(enc.dim, at.x, at.z, at.y);
    tearApart(e, "its_eyes");
    if (!st || !enc.spawnBody(st.loc, { state: "stare", stoop: st.stoop, silent: true, autoPeek: false })) return enc.result("seen_through", true);
    enc.emit("eyes", { what: "it_was_it", x: st.loc.x, y: st.loc.y, z: st.loc.z });
    sighting(enc, p);
    await enc.wait(50);
    enc.result("seen_through", true);
    enc.discover("its_eyes");
  },
});
