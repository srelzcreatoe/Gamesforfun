// @ts-check
// E22 "Signs" — a sign stands by the player's bed or front door that they did not put there: their
// name, the time they last slept, "I was here". Placed only where nobody can see it go up.
// Rare by design: stage 3+, at most once every 3 in-game days, never over anything (an empty cell
// only), never inside a Ward Lantern's radius. Like every change it is in the ledger: it disappears
// after 20 minutes, breaking it drops nothing, and Undo removes it.
import { BlockPermutation } from "@minecraft/server";
import { register } from "../director/director.js";
import { V, safe, pick, dimIndex, allPlayers } from "../core/util.js";
import { DOORS } from "../core/constants.js";
import * as ledger from "../world/ledger.js";
import { findBlocks } from "../world/manipulate.js";
import { isReplaceable, isWarded, loaded } from "../world/space.js";
import { lineOfSight } from "../world/sight.js";
import { clockTime } from "../observer/pages.js";

const SIGN = "minecraft:standing_sign";
/** Blocks a standing sign should not stand on (not a full floor, or something of the player's). */
const NOT_FLOOR = /leaves|slab|stairs|fence|wall|door|glass|pane|carpet|snow_layer|torch|lantern|sign|bed|chest|barrel|shulker|rail|button|lever|pressure_plate|flower|sapling|campfire|candle|cake|pot|head|skull|banner|observer:/;
const LIFETIME = 20 * 60;

/** Can any player see this block cell right now? */
function seen(dim, cell) {
  const c = { x: cell.x + 0.5, y: cell.y + 0.6, z: cell.z + 0.5 };
  return allPlayers().some((p) => {
    if (p.dimension.id !== dim.id || V.dist(p.location, c) > 64) return false;
    const eye = p.getHeadLocation();
    return V.angle(p.getViewDirection(), V.sub(c, eye)) < 75 && lineOfSight(dim, eye, c).clear;
  });
}

/** An empty floor cell beside the bed or a door of the home, out of sight. */
export function signCell(p, home) {
  const dim = p.dimension;
  const d = dimIndex(dim.id);
  const spawn = safe(() => p.getSpawnPoint());
  const anchors = [];
  if (spawn && spawn.dimension.id === dim.id && V.hdist(spawn, home) < 16) anchors.push({ x: Math.floor(spawn.x), y: Math.floor(spawn.y), z: Math.floor(spawn.z), kind: "bed" });
  for (const l of findBlocks(dim, home, 12, 4, DOORS, 6)) {
    const b = safe(() => dim.getBlock(l));
    if (b && !b.permutation.getState("upper_block_bit")) anchors.push({ ...l, kind: "door" });
  }
  for (const a of anchors.sort(() => Math.random() - 0.5)) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
      for (const dy of [0, 1, -1]) {
        const cell = { x: a.x + dx, y: a.y + dy, z: a.z + dz };
        if (!loaded(dim, cell) || isWarded(d, cell) || ledger.at(d, cell) || ledger.occupied(dim, cell)) continue;
        const b = safe(() => dim.getBlock(cell));
        const below = b && safe(() => b.below());
        const above = b && safe(() => b.above());
        if (!b || !b.isAir || !below || below.isAir || below.isLiquid || isReplaceable(below) || NOT_FLOOR.test(below.typeId)) continue;
        if (!above || !isReplaceable(above)) continue;
        if (seen(dim, cell)) continue;
        return { cell, anchor: a };
      }
    }
  }
  return undefined;
}

/** Sign text (translation key + arguments), chosen from what it knows. @param {import("@minecraft/server").Player} p @param {any} s */
function message(p, s, anchor) {
  const opts = [["observer.sign.name", [p.name]], ["observer.sign.here", []], ["observer.sign.behind", []], ["observer.sign.again", []]];
  if (s.lastSleep !== undefined && anchor.kind === "bed") opts.push(["observer.sign.slept", [clockTime(s.lastSleep)]], ["observer.sign.slept", [clockTime(s.lastSleep)]]);
  if (anchor.kind === "door") opts.push(["observer.sign.door", []], ["observer.sign.door", []]);
  if (s.sightings >= 2) opts.push(["observer.sign.looked", [String(s.sightings)]]);
  return /** @type {[string, string[]]} */ (pick(opts));
}

register({
  id: "sign",
  tier: 2,
  minStage: 3,
  needsBody: false,
  minManip: 1,
  cooldown: 3600,
  weight(c) {
    if (c.d !== 0 || !c.haunt || c.hauntDist > 48) return 0;
    return 5;
  },
  prepare(enc) {
    const h = enc.ctx.haunt;
    if (!h) return false;
    const found = signCell(enc.p, h.center);
    if (!found) return false;
    enc.data.found = found;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const { cell, anchor } = enc.data.found;
    enc.restoreDelay = LIFETIME;
    // the text faces the bed / door it was left by (ground_sign_direction 0 = facing south, steps of 22.5 degrees)
    const toward = { x: anchor.x + 0.5, y: cell.y, z: anchor.z + 0.5 };
    const yaw = V.yawTo({ x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }, toward);
    const dir = ((Math.round(yaw / 22.5) % 16) + 16) % 16;
    const perm = safe(() => BlockPermutation.resolve(SIGN, { ground_sign_direction: dir }));
    if (!perm) return enc.result("no_sign");
    const e = ledger.change(enc.dim, cell, perm, { enc: enc.id, kind: "sign", restoreIn: LIFETIME, flags: ledger.F.NODROP, expect: (b) => b.isAir });
    if (!e) return enc.result("deferred");
    const [key, args] = message(p, enc.s, anchor);
    safe(() => {
      const sign = enc.dim.getBlock(cell)?.getComponent("minecraft:sign");
      sign?.setText({ translate: key, with: args });
      sign?.setWaxed(true);
    });
    enc.emit("sign", { x: cell.x, y: cell.y, z: cell.z, key, anchor: anchor.kind });
    enc.log(`sign at ${cell.x},${cell.y},${cell.z} (${key}) by the ${anchor.kind}`);
    // it is noticed when the player stands near it and looks at it (watched for 90 s; the sign stays 20 min)
    const c = { x: cell.x + 0.5, y: cell.y + 0.6, z: cell.z + 0.5 };
    const found = await enc.until(() => {
      if (V.dist(p.location, c) > 6) return false;
      const eye = p.getHeadLocation();
      return V.angle(p.getViewDirection(), V.sub(c, eye)) < 25 && lineOfSight(enc.dim, eye, c).clear;
    }, 20 * 90, 10);
    enc.result(found ? "read" : "unread", found);
  },
});
