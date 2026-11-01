// @ts-check
// E26 "Not Yours" (1.2.0) — it does not share. From the third stage, when another creature hurts a player (any hostile
// one, Minecraft's own or another add-on's; always when it is one of the kinds marked as its rival, otherwise one time
// in two, and at most every 8 minutes), it is suddenly standing right behind that creature. The creature stops,
// turns, and is torn apart where it stands; it looks at the player a moment longer — they are its, not anyone
// else's — and is gone. It never touches the player. Needs a stand spot behind the creature, in the player's sight.
import { register, tryManual } from "../director/director.js";
import * as body from "../observer/body.js";
import { standing, tearApart, isHeld } from "../observer/dominion.js";
import { S } from "../core/settings.js";
import { V, safe, emit, DEBUG } from "../core/util.js";
import { standNear } from "../world/space.js";
import { lineOfSight } from "../world/sight.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

/** player id -> the creature that last hurt them (for the encounter to pick up) @type {Map<string, Entity>} */
const attackers = new Map();

/** A creature hurt a player. @param {Player} p @param {Entity|undefined} by @param {number} damage */
export function onHurt(p, by, damage) {
  // only a blow that hurts; and never one of the creatures it holds or has taken for its own (those are its)
  if (!by || damage <= 0 || !S().enabled || S().creatures === false) return;
  if (isHeld(by.id) || safe(() => by.getDynamicProperty("observer:puppet"), undefined) !== undefined) return;
  const as = standing(by);
  if (!as) return;
  // it is already here: what touches its own, it tears apart on the spot
  const b = body.get();
  if (b && b.e.dimension.id === by.dimension.id && V.dist(b.e.location, by.location) <= 24) {
    tearApart(by, "touched_its_own");
    return;
  }
  const go = DEBUG.notYours === "always" || as === "rival" || (DEBUG.notYours !== "never" && Math.random() < 0.5);
  emit("dominion", { what: "hurt", player: p.name, type: by.typeId, as, go });
  if (!go) return;
  attackers.set(p.id, by);
  tryManual("not_yours", p);
}

/** @param {Player} p */
function nearest(p) {
  const near = safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 16 }), []) ?? [];
  return near.filter((e) => standing(e)).sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location))[0];
}

register({
  id: "not_yours",
  tier: 2,
  minStage: 3,
  needsBody: true,
  manual: true,
  reactNear: false,
  cooldown: 480,
  weight: () => 1,
  prepare(enc) {
    // the creature that hurt them — or, from the Config Wheel, the nearest that answers to it
    const a = attackers.get(enc.p.id) ?? nearest(enc.p);
    attackers.delete(enc.p.id);
    if (!a || !a.isValid || a.dimension.id !== enc.dimId || V.dist(a.location, enc.p.location) > 16) return false;
    // right behind it, as seen from the player, with its head in the player's sight
    const eye = enc.p.getHeadLocation();
    const dir = V.flat(V.sub(a.location, enc.p.location));
    for (const k of [1.6, 2.2, 1.2, 2.8]) {
      const want = V.add(a.location, V.scale(dir, k));
      const st = standNear(enc.dim, want.x, want.z, a.location.y);
      if (!st || Math.abs(st.loc.y - a.location.y) > 1.5 || V.dist(st.loc, enc.p.location) < 2.5) continue;
      const head = { x: st.loc.x, y: st.loc.y + (st.stoop ? 2.45 : 3.62), z: st.loc.z };
      if (!lineOfSight(enc.dim, eye, head).clear || !lineOfSight(enc.dim, head, eye).clear) continue;
      enc.data.attacker = a;
      enc.data.spot = st;
      return true;
    }
    return false;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {Entity} */
    const a = enc.data.attacker;
    const st = enc.data.spot;
    if (!a.isValid) return enc.result("gone");
    // it is suddenly there, behind the creature, looking down at it
    const b = enc.spawnBody(st.loc, { state: "stare", stoop: st.stoop, autoPeek: false, face: safe(() => a.getHeadLocation(), a.location) });
    if (!b) return enc.result("deferred");
    b.faceTarget = false;
    safe(() => a.addEffect("slowness", 40, { amplifier: 7, showParticles: false }));
    safe(() => a.addEffect("weakness", 40, { amplifier: 4, showParticles: false }));
    enc.emit("dominion", { what: "behind", type: a.typeId });
    await enc.wait(8);
    // the creature knows: it turns to it
    if (a.isValid) safe(() => a.setRotation({ x: -30, y: V.yawTo(a.location, st.loc) }));
    await enc.wait(14);
    if (a.isValid) tearApart(a, "not_yours");
    // and it looks at the player: theirs is not anyone else's to take
    body.faceTo(p.getHeadLocation());
    await enc.wait(40);
    enc.result("defended", true);
    enc.discover("not_yours");
  },
});
