// @ts-check
// E31 "What Was Left" (1.3.0) — it hunts its rivals. A creature of a kind you have marked as its rival (Config Wheel →
// Other creatures), somewhere near you but out of everyone's sight, is hunted: it is standing behind it, and it tears
// it apart. You hear it, far off — a crack, and a scream. Go and look, and there are its footprints, and crimson shreds
// where the creature was. From the second stage; needs a rival within 64 blocks that nobody can see.
import { register } from "../director/director.js";
import { standing, tearApart } from "../observer/dominion.js";
import * as puppets from "../observer/puppets.js";
import { discover } from "../progression/discoveries.js";
import { now } from "../core/state.js";
import { V, safe, emit, allPlayers } from "../core/util.js";
import { S } from "../core/settings.js";
import { SOUNDS, PARTICLES } from "../core/constants.js";
import { standNear } from "../world/space.js";
import { seenByAny } from "../world/sight.js";
import { trailBetween } from "./common.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {{x:number,y:number,z:number}} Vec */

/** What was left: crimson shreds that show to whoever finds the place (for 5 minutes). @type {{dimId:string, at:Vec, t:number, found:Set<string>}[]} */
const remains = [];

const seen = (/** @type {Entity} */ e) => seenByAny(allPlayers().filter((o) => o.dimension.id === e.dimension.id), e.location, false,
  [{ x: e.location.x, y: e.location.y + 1, z: e.location.z }, { x: e.location.x, y: e.location.y + 1.8, z: e.location.z }]);

/** A rival near this player that nobody can see. @param {Player} p */
function quarry(p) {
  if (!S().enabled || S().creatures === false) return undefined;
  return (safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 64 }), []) ?? [])
    .find((e) => standing(e) === "rival" && !puppets.isPuppet(e) && V.dist(e.location, p.location) >= 16 && !seen(e));
}

register({
  id: "rival_hunt",
  tier: 1,
  minStage: 2,
  needsBody: true,
  cooldown: 900,
  reactNear: false,
  weight(c) {
    return quarry(c.p) ? 4 : 0;
  },
  prepare(enc) {
    const e = quarry(enc.p);
    if (!e) return false;
    // behind it, as seen from the player — and unseen
    const away = V.flat(V.sub(e.location, enc.p.location));
    const want = V.add(e.location, V.scale(away, 1.8));
    const st = standNear(enc.dim, want.x, want.z, e.location.y);
    if (!st || Math.abs(st.loc.y - e.location.y) > 2) return false;
    enc.data.e = e;
    enc.data.spot = st;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {Entity} */
    const e = enc.data.e;
    const st = enc.data.spot;
    if (!e.isValid) return enc.result("gone");
    if (!enc.spawnBody(st.loc, { state: "stare", stoop: st.stoop, silent: true, autoPeek: false, face: safe(() => e.getHeadLocation(), e.location) })) return enc.result("deferred");
    safe(() => e.addEffect("slowness", 40, { amplifier: 7, showParticles: false }));
    await enc.wait(16);
    if (!e.isValid) return enc.result("gone");
    const at = { ...e.location };
    tearApart(e, "hunted");
    // far off, a crack and a scream — the player hears where
    safe(() => p.playSound(SOUNDS.crack, { location: at, volume: 1 }));
    safe(() => p.playSound(SOUNDS.shriek, { location: at, volume: 0.6 }));
    enc.caption("caption.far_off");
    // its footprints, coming to the place, and what was left
    enc.leaveTrace(trailBetween(enc.dim, st.loc, at));
    remains.push({ dimId: enc.dimId, at, t: now(), found: new Set() });
    while (remains.length > 6) remains.shift();
    enc.emit("rival", { what: "hunted", x: at.x, y: at.y, z: at.z });
    await enc.wait(10);
    enc.result("hunted");
  },
});

/** Every second: whoever comes to the place finds the crimson shreds (and the page). */
export function tick() {
  const t = now();
  for (let i = remains.length - 1; i >= 0; i--) if (t - remains[i].t > 300) remains.splice(i, 1);
  for (const r of remains) {
    for (const p of allPlayers()) {
      if (p.dimension.id !== r.dimId || r.found.has(p.id) || V.dist(p.location, r.at) > 8) continue;
      r.found.add(p.id);
      safe(() => p.spawnParticle(PARTICLES.puppetBurst, r.at));
      emit("rival", { what: "found", player: p.name });
      discover(p, "what_was_left");
    }
  }
}
