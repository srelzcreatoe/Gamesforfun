// @ts-check
// The Mire Eyebloom (1.5.1): a plant three blocks tall that grows in the Weeping Mire — a black-green stalk with
// drooping, red-veined leaves, and for a flower a single eye in a halo of dark petals. The eye is never still (its
// texture is a flipbook: it looks about, it blinks, its pupil widens). And here:
//   * they turn to look at you — but only while you are not looking at them: look back, and every one of them is
//     already facing you;
//   * stare at one from close by and it shuts its eye, and opens it again once you look away;
//   * they weep: dark red drops fall from the eye, and red spores drift up from it;
//   * break any part of one and the whole plant comes down (the eye may leave a spider eye behind).
// Placed by the Mire's worldgen (feature_rules/weeping_mire_eyeblooms.json, structures/wmire/eyebloom.mcstructure).
import { system, BlockVolume } from "@minecraft/server";
import { PARTICLES } from "../core/constants.js";
import { V, safe, emit, allPlayers, DEBUG } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {{x:number,y:number,z:number}} Vec */

export const HEAD = "wmire:eyebloom";
export const STALK = "wmire:eyebloom_stalk";
const PARTS = new Set([HEAD, STALK]);
/** Its own state (not one of the vanilla states the typings know). */
const SHUT = /** @type {any} */ ("wmire:shut");

/** Break one part and the rest of that plant comes down with it. @param {Dimension} dim @param {Vec} l */
export function fell(dim, l) {
  let n = 0;
  for (const dir of [1, -1]) {
    for (let k = 1; k <= 2; k++) {
      const y = l.y + dir * k;
      const b = safe(() => dim.getBlock({ x: l.x, y, z: l.z }));
      if (!b || !PARTS.has(b.typeId)) break;
      if (safe(() => dim.runCommand(`setblock ${l.x} ${y} ${l.z} air destroy`))) n++;
    }
  }
  emit("eyebloom", { what: "fell", n, x: l.x, y: l.y, z: l.z });
  return n;
}

const component = {
  /** @param {import("@minecraft/server").BlockComponentPlayerBreakEvent} ev */
  onPlayerBreak(ev) {
    const l = ev.block.location;
    const dim = ev.dimension;
    system.run(() => fell(dim, { x: l.x, y: l.y, z: l.z }));
  },
};

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent("wmire:eyebloom", component);
});

/** The side of a block facing toward a point. @param {Vec} from @param {Vec} to */
function cardinalTo(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? "east" : "west";
  return dz > 0 ? "south" : "north";
}

/** Eyes shut until this tick, by block. @type {Map<string, number>} */
const shutUntil = new Map();

/**
 * Every second: for each player in the Mire (or anywhere, in tests), the eyeblooms within 20 blocks turn to them
 * while unwatched, shut when stared at, and weep. @param {(p: Player) => boolean} inMire
 */
export function tick(inMire) {
  if (DEBUG.eyes === "never") return;
  const t = system.currentTick;
  for (const [k, until] of shutUntil) if (until < t - 200) shutUntil.delete(k);
  for (const p of allPlayers()) {
    if (p.dimension.id !== "minecraft:overworld" || (DEBUG.eyes !== "always" && !inMire(p))) continue;
    const dim = p.dimension;
    const l = p.location;
    const found = safe(() => dim.getBlocks(new BlockVolume({ x: l.x - 20, y: l.y - 8, z: l.z - 20 }, { x: l.x + 20, y: l.y + 10, z: l.z + 20 }), { includeTypes: [HEAD] }, true));
    if (!found) continue;
    const eye = p.getHeadLocation();
    const view = p.getViewDirection();
    let n = 0, turned = 0, shut = 0;
    for (const loc of found.getBlockLocationIterator()) {
      if (++n > 40) break;
      const b = safe(() => dim.getBlock(loc));
      if (!b || b.typeId !== HEAD) continue;
      const c = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
      const ang = V.angle(view, V.sub(c, eye));
      const d = V.dist(c, eye);
      const key = `${loc.x},${loc.y},${loc.z}`;
      // stared at from close by: it shuts its eye; it opens again a little after you look away
      if (d < 10 && ang < 9) shutUntil.set(key, t + 30);
      const isShut = (shutUntil.get(key) ?? 0) > t;
      // it only turns while you are not looking at it
      const face = ang > 50 ? cardinalTo(c, eye) : String(b.permutation.getState("minecraft:cardinal_direction"));
      const was = b.permutation;
      if (was.getState("minecraft:cardinal_direction") !== face || !!was.getState(SHUT) !== isShut) {
        const ok = safe(() => {
          b.setPermutation(was.withState("minecraft:cardinal_direction", face).withState(SHUT, isShut));
          return true;
        });
        if (ok) {
          if (was.getState("minecraft:cardinal_direction") !== face) turned++;
          if (!!was.getState(SHUT) !== isShut && isShut) shut++;
        }
      }
      // it weeps
      if (Math.random() < 0.3) safe(() => dim.spawnParticle(PARTICLES.eyeSpore, c));
      if (Math.random() < 0.2) safe(() => dim.spawnParticle(PARTICLES.eyeDrip, c));
    }
    if (turned || shut) emit("eyebloom", { what: "look", player: p.name, n, turned, shut });
  }
}
