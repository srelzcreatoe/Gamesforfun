// @ts-check
// It returns what you threw away. Something a player drops by hand and walks away from turns up
// later on their doorstep: the very same item entity is moved there (nothing is copied, so nothing
// can be duplicated), with a knock at the door. Stage 2+, at most once per in-game day per player,
// only when they have a home it knows, and only while the item still exists (dropped items vanish
// after five minutes). Settings: "It returns things" (on by default).
import { world } from "@minecraft/server";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { S } from "../core/settings.js";
import { V, safe, rand, emit, trace, allPlayers, dimIndex } from "../core/util.js";
import { SOUNDS, DOORS } from "../core/constants.js";
import { primaryHaunt } from "./memory.js";
import { findBlocks } from "../world/manipulate.js";
import { standAt, isWarded } from "../world/space.js";
import { visibility } from "../world/sight.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

const MIN_AGE = 45;   // seconds since it was dropped
const MIN_AWAY = 24;  // blocks between the item and the player's home (and the player)
const PER_PLAYER = 6;

/** @type {Map<string, {e: Entity, t: number, dimId: string, what: string}[]>} player id -> items they dropped */
const dropped = new Map();

/**
 * Did this player just throw this item? A thrown item appears at chest height right at the player
 * (block drops appear at a block centre, death drops at the feet of a dead player).
 * @param {Entity} item
 */
function dropperOf(item) {
  const l = item.location;
  for (const p of item.dimension.getPlayers({ location: l, maxDistance: 3 })) {
    const pl = p.location;
    const dy = l.y - pl.y;
    const hp = p.getComponent("minecraft:health");
    if (hp && hp.currentValue <= 0) continue;
    if (V.hdist(l, pl) <= 1.2 && dy >= 0.7 && dy <= 2.0) return p;
  }
  return undefined;
}

/** A doorstep: a free floor cell next to a door of the home (else beside the bed), out of sight. @param {Player} p @param {{x:number,y:number,z:number}} home */
function doorstep(p, home) {
  const dim = p.dimension;
  const d = dimIndex(dim.id);
  const doors = findBlocks(dim, home, 12, 4, DOORS, 8).filter((l) => {
    const b = safe(() => dim.getBlock(l));
    return b && !b.permutation.getState("upper_block_bit");
  });
  const spots = [];
  for (const door of doors) {
    // the outside of the door first (the side away from the middle of the home)
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: door.x + dx, y: door.y, z: door.z + dz, door }));
    side.sort((a, b) => V.hdist(b, home) - V.hdist(a, home));
    spots.push(...side);
  }
  for (let i = 0; i < 8; i++) spots.push({ x: Math.floor(home.x + rand(-3, 3)), y: Math.floor(home.y), z: Math.floor(home.z + rand(-3, 3)), door: undefined });
  for (const sp of spots) {
    const st = standAt(dim, sp.x + 0.5, sp.z + 0.5, sp.y + 1.5, 4);
    if (!st || st.liquid || isWarded(d, st.loc)) continue;
    if (Math.abs(st.loc.y - sp.y) > 1) continue;
    // nobody sees it arrive
    if (allPlayers().some((o) => o.dimension.id === dim.id && visibility(o, st.loc, { fov: 70, maxDist: 64 }).points > 0)) continue;
    return { loc: { x: st.loc.x, y: st.loc.y + 0.1, z: st.loc.z }, door: sp.door };
  }
  return undefined;
}

/** Every 5 s. */
export function tick() {
  const c = S();
  const t = now();
  for (const [pid, list] of [...dropped]) {
    for (const it of [...list]) if (!it.e.isValid || t - it.t > 320) list.splice(list.indexOf(it), 1);
    if (list.length === 0) dropped.delete(pid);
  }
  if (!c.enabled || c.returns === false || c.manipulation === 0) return;
  for (const p of allPlayers()) {
    const list = dropped.get(p.id);
    if (!list) continue;
    const s = ps(p);
    if (s.stage < 2 || t < (s.returnAt ?? 0) || (s.witnessed && s.endMode === "rest")) continue;
    const h = primaryHaunt(p);
    if (!h || V.hdist(p.location, h.center) > 16) continue;
    const it = list.find((x) => x.dimId === p.dimension.id && t - x.t >= MIN_AGE
      && V.hdist(x.e.location, h.center) >= MIN_AWAY && V.dist(x.e.location, p.location) >= MIN_AWAY);
    if (!it) continue;
    returnItem(p, it, h.center);
  }
}

/** @param {Player} p @param {{e: Entity, t: number, dimId: string, what: string}} it @param {{x:number,y:number,z:number}} home */
function returnItem(p, it, home) {
  const spot = doorstep(p, home);
  const s = ps(p);
  if (!spot) {
    s.returnAt = now() + 60;
    return false;
  }
  if (!safe(() => {
    it.e.teleport(spot.loc);
    it.e.clearVelocity();
    return true;
  }, false)) return false;
  const list = dropped.get(p.id) ?? [];
  list.splice(list.indexOf(it), 1);
  s.returnAt = now() + rand(1200, 1800) / Math.max(0.5, S().frequency);
  markPlayerDirty(p);
  // a knock at the door it was left by
  const knockAt = spot.door ? { x: spot.door.x + 0.5, y: spot.door.y + 1, z: spot.door.z + 0.5 } : spot.loc;
  safe(() => p.playSound(SOUNDS.knock, { location: knockAt, volume: 0.9 }));
  trace(`${p.name}: returned ${it.what} to ${V.str(spot.loc)}`);
  emit("returned", { player: p.name, item: it.what, x: spot.loc.x, y: spot.loc.y, z: spot.loc.z, door: !!spot.door });
  return true;
}

/**
 * Tests / Config Wheel: return the newest item this player dropped now, once they are minAway blocks
 * from it (ignores the stage, the timers and the distance from home). @param {Player} p @param {{minAway?:number}} [o]
 */
export function returnNow(p, o = {}) {
  const list = dropped.get(p.id);
  const h = primaryHaunt(p);
  if (!list || !list.length || !h) return false;
  const it = list[list.length - 1];
  if (!it.e.isValid || it.dimId !== p.dimension.id || V.dist(it.e.location, p.location) < (o.minAway ?? 0)) return false;
  return returnItem(p, it, h.center);
}

export const tracked = (pid) => (dropped.get(pid) ?? []).filter((x) => x.e.isValid).length;

export function registerEvents() {
  world.afterEvents.entitySpawn.subscribe((ev) => {
    const e = ev.entity;
    if (e.typeId !== "minecraft:item" || !e.isValid) return;
    const p = safe(() => dropperOf(e));
    if (!p) return;
    const what = safe(() => e.getComponent("minecraft:item")?.itemStack.typeId, "") ?? "";
    const list = dropped.get(p.id) ?? [];
    list.push({ e, t: now(), dimId: e.dimension.id, what });
    while (list.length > PER_PLAYER) list.shift();
    dropped.set(p.id, list);
    emit("returns", { what: "tracked", player: p.name, item: what, id: e.id });
  });
}

/** @param {string} pid */
export const forget = (pid) => dropped.delete(pid);
