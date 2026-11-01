// @ts-check
// E28 "Knocking" (1.3.0). At night, at home, indoors: three knocks at your door — and again, a little later. One of the
// creatures that answer to it is standing outside it, put there unseen, its eyes in it. Open the door and it is there,
// looking at you — and then it comes apart where it stands. Leave the door shut and, once the knocking stops, there is
// nothing outside. It never comes in, and it never hurts you.
// From the third stage; needs your home (where you sleep), a door of it within 12 blocks, and a creature that answers
// to it within 48 blocks.
import { register } from "../director/director.js";
import * as puppets from "../observer/puppets.js";
import { standing, isHeld } from "../observer/dominion.js";
import { primaryHaunt } from "../observer/memory.js";
import { SOUNDS, DOORS } from "../core/constants.js";
import { V, safe, allPlayers } from "../core/util.js";
import { S } from "../core/settings.js";
import { findBlocks } from "../world/manipulate.js";
import { standAt } from "../world/space.js";
import { seenByAny } from "../world/sight.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */

/** The outside of a door of their home (lower half), with a creature to stand there. @param {Player} p */
function scene(p) {
  if (!S().enabled || S().puppets === false) return undefined;
  const h = primaryHaunt(p);
  if (!h || V.hdist(p.location, h.center) > 16) return undefined;
  const dim = p.dimension;
  const creature = (safe(() => dim.getEntities({ location: p.location, maxDistance: 48, families: ["monster"] }), []) ?? [])
    .find((e) => standing(e) === "kin" && !isHeld(e.id) && !puppets.isPuppet(e) && !e.nameTag);
  if (!creature) return undefined;
  for (const d of findBlocks(dim, p.location, 12, 3, DOORS, 8)) {
    const b = safe(() => dim.getBlock(d));
    if (!b || b.permutation.getState("upper_block_bit") || b.permutation.getState("open_bit")) continue;
    // the side of the door away from the player (outside, as seen from where they are)
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => ({ x: d.x + dx, y: d.y, z: d.z + dz }))
      .sort((a, c) => V.hdist(c, p.location) - V.hdist(a, p.location));
    for (const c of sides.slice(0, 2)) {
      const st = standAt(dim, c.x + 0.5, c.z + 0.5, c.y + 1.5, 3);
      if (!st || Math.abs(st.loc.y - d.y) > 1) continue;
      const pts = [{ x: st.loc.x, y: st.loc.y + 1, z: st.loc.z }, { x: st.loc.x, y: st.loc.y + 1.8, z: st.loc.z }];
      if (seenByAny(allPlayers().filter((o) => o.dimension.id === dim.id), st.loc, false, pts)) continue;
      return { door: d, stand: st.loc, creature };
    }
  }
  return undefined;
}

register({
  id: "knocking",
  tier: 2,
  minStage: 3,
  needsBody: false,
  minManip: 0,
  cooldown: 2400,
  weight(c) {
    if (c.d !== 0 || !c.night || !c.sheltered || c.hauntDist > 16) return 0;
    return scene(c.p) ? 5 : 0;
  },
  prepare(enc) {
    const sc = scene(enc.p);
    if (!sc) return false;
    enc.data.sc = sc;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const { door, stand, creature } = enc.data.sc;
    const doorAt = { x: door.x + 0.5, y: door.y + 1, z: door.z + 0.5 };
    const pp = puppets.take(creature, "knock", { p, mode: "stand", seconds: 60, face: doorAt });
    if (!pp) return enc.result("deferred");
    if (!puppets.place(pp, stand, doorAt)) {
      puppets.release(pp.id, "quiet");
      return enc.result("deferred");
    }
    enc.emit("knock", { what: "outside", type: creature.typeId, x: stand.x, y: stand.y, z: stand.z });
    const isOpen = () => !!safe(() => enc.dim.getBlock(door)?.permutation.getState("open_bit"), false);
    let opened = false;
    // three knocks; a pause; three more; a long pause; three more
    for (const pause of [0, 70, 120]) {
      for (let t = 0; t < pause && !opened; t += 5) {
        await enc.wait(5);
        opened = isOpen();
      }
      if (opened) break;
      for (let k = 0; k < 3 && !opened; k++) {
        enc.worldSound(SOUNDS.knock, doorAt, 0.9, 0.95 + k * 0.03);
        await enc.wait(9);
        opened = isOpen();
      }
      enc.emit("knock", { what: "knocks" });
      enc.caption("caption.knock");
    }
    for (let t = 0; t < 200 && !opened; t += 5) {
      await enc.wait(5);
      opened = isOpen();
    }
    if (!opened || !pp.e.isValid) {
      // the knocking stops, and there is nothing outside
      if (puppets.get(pp.id)) puppets.release(pp.id, "gone");
      enc.emit("knock", { what: "nothing" });
      return enc.result("ignored");
    }
    // they opened it: it is there, looking at them — and then it comes apart
    pp.face = undefined;
    enc.emit("knock", { what: "opened" });
    await enc.wait(30);
    if (puppets.get(pp.id)) puppets.release(pp.id, "torn");
    enc.result("opened", true);
    enc.discover("who_knocks");
  },
});
