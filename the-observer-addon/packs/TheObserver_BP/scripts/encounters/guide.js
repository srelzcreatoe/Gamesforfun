// @ts-check
// E32 "The Guide" (1.4.0). A creature near you looks straight at you — and walks off. A little way on it stops and
// looks back, and waits; when you come, it walks on; when you fall behind, it stops again and looks back at you. It
// leads you somewhere, out of the way: to something of yours it took (the newest thing you threw away), or to one of
// its pages (written in your Field Notes as you get there), or to it — standing behind its guide, waiting. Then the
// possession is torn out of the guide and it is itself again. Never follow, and in a while it gives up and goes back
// to where it was.
// From the second stage; needs a creature (one that answers to it, a farm animal, a villager) 8-20 blocks off, in
// sight, and a hidden place 26-42 blocks away.
import { register } from "../director/director.js";
import * as puppets from "../observer/puppets.js";
import * as body from "../observer/body.js";
import * as returns from "../observer/returns.js";
import * as pages from "../observer/pages.js";
import { standing, isHeld } from "../observer/dominion.js";
import { V, safe } from "../core/util.js";
import { S } from "../core/settings.js";
import { findSpot, standNear } from "../world/space.js";
import { lineOfSight } from "../world/sight.js";
import { sighting } from "./common.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

const KINDS = /^minecraft:(cow|mooshroom|sheep|pig|chicken|goat|villager_v2|horse|donkey|mule|llama|fox|rabbit|cat|ocelot)$/;

/** A creature 8-20 blocks off, in sight. @param {Player} p */
function candidate(p) {
  if (!S().enabled || S().puppets === false) return undefined;
  const eye = p.getHeadLocation();
  const marks = S().marks ?? {};
  return (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 20, excludeTypes: ["minecraft:player", "minecraft:item"] }), []) ?? [])
    .filter((e) => !e.typeId.startsWith("observer:") && !puppets.isPuppet(e) && !isHeld(e.id) && !safe(() => e.nameTag, "")
      && !safe(() => e.hasComponent("minecraft:is_tamed"), false) && marks[e.typeId] !== "ignore"
      && (standing(e) === "kin" || KINDS.test(e.typeId) || marks[e.typeId] === "puppet") && V.hdist(e.location, p.location) >= 8)
    .find((e) => lineOfSight(p.dimension, eye, safe(() => e.getHeadLocation(), e.location) ?? e.location).clear);
}

register({
  id: "guide",
  tier: 2,
  minStage: 2,
  needsBody: true,
  cooldown: 1800,
  reactNear: false,
  weight(c) {
    if (c.water || c.gliding || c.d !== 0 || c.elevated) return 0;
    return candidate(c.p) ? 3 : 0;
  },
  prepare(enc) {
    const p = enc.p;
    const g = candidate(p);
    if (!g) return false;
    const dest = findSpot(p, { minDist: 26, maxDist: 42, concealment: "hidden", watchLOSIgnoringView: true, yMode: "near", samples: 48 })
      ?? findSpot(p, { minDist: 22, maxDist: 42, yMode: "near", samples: 48 });
    if (!dest) return false;
    enc.data.g = g;
    enc.data.dest = dest.loc;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {Entity} */
    const g = enc.data.g;
    const dest = enc.data.dest;
    const pp = puppets.take(g, "guide", { p, mode: "stand", seconds: 200, home: true });
    if (!pp) return enc.result("deferred");
    // it looks straight at them first
    enc.emit("guide", { what: "looks", type: g.typeId });
    await enc.wait(40);
    if (puppets.get(pp.id) !== pp) return enc.result("lost");
    puppets.setMode(pp, "lead", { to: dest });
    // what it leads them to: something of theirs, one of its pages, or it
    const it = returns.takeAway(p, 12);
    const payoff = it ? "returns" : Math.random() < 0.5 ? "page" : "observer";
    enc.emit("guide", { what: "leads", payoff, d: Math.round(V.hdist(dest, p.location)), x: dest.x, y: dest.y, z: dest.z });
    let reached = false, left = 0, placed = false;
    for (let t = 0; t < 20 * 150 && puppets.get(pp.id) === pp; t += 5) {
      await enc.wait(5);
      if (pp.arrived && it && !placed) {
        placed = !!safe(() => {
          it.teleport({ x: dest.x, y: dest.y + 0.2, z: dest.z });
          it.clearVelocity();
          return true;
        }, false);
      }
      if (pp.arrived && V.hdist(p.location, dest) < 5) {
        reached = true;
        break;
      }
      // nobody follows: in a while it gives up
      left = V.hdist(p.location, pp.e.location) > 40 ? left + 5 : 0;
      if (left > 20 * 20) break;
    }
    if (!reached || puppets.get(pp.id) !== pp) {
      if (puppets.get(pp.id) === pp) puppets.release(pp.id, "home");
      enc.emit("guide", { what: "gave_up" });
      return enc.result("ignored");
    }
    enc.emit("guide", { what: "there", payoff });
    if (payoff === "observer") {
      // it, standing behind its guide
      const away = V.flat(V.sub(pp.e.location, p.location));
      const want = V.add(pp.e.location, V.scale(away, 2.4));
      const st = standNear(enc.dim, want.x, want.z, pp.e.location.y);
      if (st && enc.spawnBody(st.loc, { state: "stare", stoop: st.stoop, silent: true, autoPeek: false })) {
        body.faceTo(p.getHeadLocation());
        enc.emit("guide", { what: "it_waited" });
        sighting(enc, p);
      }
      await enc.wait(40);
    } else if (payoff === "page") {
      pages.write(p);
      safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.guide_page" }] }));
      await enc.wait(30);
    } else {
      safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.guide_returns" }] }));
      await enc.wait(30);
    }
    if (puppets.get(pp.id) === pp) puppets.release(pp.id, "torn_out");
    enc.result("followed", true);
    enc.discover("the_guide");
  },
});
