// @ts-check
// The ledger records every block the Observer changes:
//   original permutation, the permutation it set, owning encounter, restore time, flags.
// Rules
//   * one entry per block position at a time (a position already in the ledger is locked)
//   * restoration only happens if the block still holds what the Observer set;
//     if a player changed it since, the player's change wins and the entry is dropped
//   * blocks the Observer placed never drop items when broken (no duplication)
//   * entries persist in world dynamic properties, so restoration survives reloads
//   * unloaded positions wait until their chunk is loaded again
import { world, system, BlockPermutation } from "@minecraft/server";
import { saveJSON, loadJSON, now } from "../core/state.js";
import { safe, blockKey, dimIndex, dimByIndex, trace, DEBUG, emit, allPlayers } from "../core/util.js";
import { isWarded, loaded } from "./space.js";
import { OBSERVER_ID } from "../core/constants.js";

/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {[string, Record<string, string|number|boolean>]} PermInfo */
/**
 * @typedef {Object} Entry
 * @property {string} k   key "d,x,y,z"
 * @property {number} d @property {number} x @property {number} y @property {number} z
 * @property {PermInfo} o original
 * @property {PermInfo} n what the Observer set
 * @property {number} enc owning encounter id
 * @property {string} kind  door|light|turn|veil|mimic|effigy|carve|torch|candle
 * @property {number} at   clock when made
 * @property {number} ra   clock when due for restoration (Infinity = only by explicit release)
 * @property {number} f    flags
 * @property {number[]} [l] linked block (upper door half) kept in step with this one
 */

export const F = { NODROP: 1, EFFIGY: 2 };
const KEY = "observer:ledger";
export const MAX_ENTRIES = 800;

/** @type {Map<string, Entry>} */
const entries = new Map();
let dirty = false;
/** @type {((e:Entry)=>void)[]} */
const changeListeners = [];
/** @type {((e:Entry, how:string, player?:import("@minecraft/server").Player)=>void)[]} */
const releaseListeners = [];

/** @param {BlockPermutation} perm @returns {PermInfo} */
function info(perm) {
  return [perm.type.id, perm.getAllStates()];
}
/** @param {PermInfo} i */
function resolve(i) {
  return BlockPermutation.resolve(i[0], i[1]);
}
/** @param {import("@minecraft/server").Block} block @param {PermInfo} i */
function holds(block, i) {
  return block.permutation.matches(i[0], i[1]);
}

export function load() {
  entries.clear();
  const arr = loadJSON(world, KEY, []);
  for (const e of arr) {
    if (e.ra === null) e.ra = Infinity; // JSON has no Infinity
    entries.set(e.k, e);
  }
  return entries.size;
}

export function save(force = false) {
  if (!dirty && !force) return;
  saveJSON(world, KEY, [...entries.values()].map((e) => ({ ...e, ra: Number.isFinite(e.ra) ? e.ra : null })));
  dirty = false;
}

export const count = () => entries.size;
/** @param {number} d @param {Vec} loc */
export const at = (d, loc) => entries.get(blockKey(d, loc));
/** @param {number} enc */
export const ofEncounter = (enc) => [...entries.values()].filter((e) => e.enc === enc);
export const all = () => [...entries.values()];
/** @param {(e:Entry)=>void} cb */
export const onChange = (cb) => changeListeners.push(cb);
/** @param {(e:Entry, how:string, player?:import("@minecraft/server").Player)=>void} cb */
export const onRelease = (cb) => releaseListeners.push(cb);

let capWarned = false;
/** Changes that put a solid block into an open cell. */
const SOLID_KINDS = new Set(["veil", "mimic", "effigy"]);
const NOT_OCCUPANTS = new Set(["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:snowball", "minecraft:egg"]);

/**
 * Is a player, mob or the Observer inside this block cell?
 * @param {import("@minecraft/server").Dimension} dim @param {Vec} loc
 */
export function occupied(dim, loc) {
  const c = { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z) + 0.5 };
  const list = safe(() => dim.getEntities({ location: { x: c.x, y: c.y + 0.5, z: c.z }, maxDistance: 3.5 }), []) ?? [];
  for (const en of list) {
    if (NOT_OCCUPANTS.has(en.typeId)) continue;
    const l = en.location;
    const h = en.typeId === OBSERVER_ID ? 2.9 : 1.9;
    if (Math.abs(l.x - c.x) < 0.85 && Math.abs(l.z - c.z) < 0.85 && l.y < c.y + 1 && l.y + h > c.y) return true;
  }
  return false;
}

/**
 * Change a block and record it.
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Vec} loc
 * @param {BlockPermutation} perm
 * @param {{enc:number, kind:string, restoreIn?:number, flags?:number, ignoreWard?:boolean, link?:Vec,
 *          expect?:(b:import("@minecraft/server").Block)=>boolean}} o
 * @returns {Entry|undefined}
 */
export function change(dim, loc, perm, o) {
  const d = dimIndex(dim.id);
  const k = blockKey(d, loc);
  if (entries.has(k)) return undefined;
  if (entries.size >= MAX_ENTRIES) {
    if (!capWarned) DEBUG.log(`ledger full (${MAX_ENTRIES} entries waiting, most in unloaded areas): no new changes until some are restored`);
    capWarned = true;
    return undefined;
  }
  capWarned = false;
  if (!loaded(dim, loc)) return undefined;
  // never put a solid block where someone stands
  if (SOLID_KINDS.has(o.kind) && occupied(dim, loc)) return undefined;
  if (!o.ignoreWard && isWarded(d, loc)) return undefined;
  const block = safe(() => dim.getBlock(loc));
  if (!block) return undefined;
  if (o.expect && !o.expect(block)) return undefined;
  const orig = info(block.permutation);
  try {
    block.setPermutation(perm);
  } catch (e) {
    DEBUG.log(`ledger change failed at ${k}: ${e}`);
    return undefined;
  }
  /** @type {Entry} */
  const e = {
    k, d, x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z),
    o: orig, n: info(block.permutation), enc: o.enc, kind: o.kind, at: now(),
    ra: o.restoreIn === undefined ? Infinity : now() + o.restoreIn, f: o.flags ?? 0,
  };
  if (o.link) e.l = [Math.floor(o.link.x), Math.floor(o.link.y), Math.floor(o.link.z)];
  entries.set(k, e);
  dirty = true;
  emit("ledger", { what: "change", kind: e.kind, x: e.x, y: e.y, z: e.z, enc: e.enc, from: e.o[0], to: e.n[0] });
  for (const cb of changeListeners) safe(() => cb(e));
  return e;
}

/**
 * Put a block back if it still holds what the Observer set.
 * @param {Entry} e
 * @returns {"restored"|"player_changed"|"pending"}
 */
export function restore(e) {
  const dim = dimByIndex(e.d);
  const loc = { x: e.x, y: e.y, z: e.z };
  if (!loaded(dim, loc)) return "pending";
  const block = safe(() => dim.getBlock(loc));
  if (!block) return "pending";
  // a carved opening is not refilled while someone stands in it
  if (e.kind === "carve" && holds(block, e.n) && occupied(dim, loc)) return "pending";
  let result = "player_changed";
  if (holds(block, e.n)) {
    const ok = safe(() => {
      block.setPermutation(resolve(e.o));
      return true;
    }, false);
    if (!ok) return "pending";
    result = "restored";
    syncLink(dim, e);
  }
  entries.delete(e.k);
  dirty = true;
  emit("ledger", { what: result, kind: e.kind, x: e.x, y: e.y, z: e.z, enc: e.enc });
  for (const cb of releaseListeners) safe(() => cb(e, result));
  return /** @type {any} */ (result);
}

/** Keep a linked upper door half in step with its lower half. */
function syncLink(dim, e) {
  if (!e.l) return;
  safe(() => {
    const lower = dim.getBlock({ x: e.x, y: e.y, z: e.z });
    const upper = dim.getBlock({ x: e.l[0], y: e.l[1], z: e.l[2] });
    if (!lower || !upper || upper.typeId !== lower.typeId) return;
    const open = lower.permutation.getState("open_bit");
    if (upper.permutation.getState("open_bit") !== open) upper.setPermutation(upper.permutation.withState("open_bit", open));
  });
}

/**
 * Detect changes made by anyone else (a player, redstone, pistons, other add-ons) to blocks owned by
 * running encounters. Called every 10 ticks for the few entries of running encounters.
 * The nearest player within 8 blocks is credited.
 * @param {Set<number>} encIds
 */
export function scan(encIds) {
  if (encIds.size === 0) return;
  for (const e of [...entries.values()]) {
    if (!encIds.has(e.enc)) continue;
    const dim = dimByIndex(e.d);
    const loc = { x: e.x, y: e.y, z: e.z };
    if (!loaded(dim, loc)) continue;
    const block = safe(() => dim.getBlock(loc));
    if (!block || holds(block, e.n)) continue;
    const c = { x: e.x + 0.5, y: e.y + 0.5, z: e.z + 0.5 };
    let who, best = 64;
    for (const p of allPlayers()) {
      if (p.dimension.id !== dim.id) continue;
      const d2 = (p.location.x - c.x) ** 2 + (p.location.y - c.y) ** 2 + (p.location.z - c.z) ** 2;
      if (d2 < best) { best = d2; who = p; }
    }
    if (holds(block, e.o)) syncLink(dim, e);
    drop(e, holds(block, e.o) ? "player_restored" : "player_changed", who);
  }
}

/** Schedule all of an encounter's changes for restoration in delay seconds (persistent ones excluded). */
export function scheduleEncounter(enc, delay, includeEffigies = false) {
  const t = now() + delay;
  for (const e of entries.values()) {
    if (e.enc !== enc) continue;
    if (e.f & F.EFFIGY && !includeEffigies) continue;
    if (e.ra > t) e.ra = t;
  }
  dirty = true;
}

/** Restore everything owned by an encounter right now (where loaded). */
export function restoreEncounterNow(enc) {
  let n = 0;
  for (const e of [...entries.values()]) if (e.enc === enc && !(e.f & F.EFFIGY) && restore(e) === "restored") n++;
  return n;
}

/** Called every second: restore what is due, a bounded number per call. */
export function processDue(maxOps = 12) {
  const t = now();
  let ops = 0;
  for (const e of [...entries.values()]) {
    if (ops >= maxOps) break;
    if (e.ra > t) continue;
    const r = restore(e);
    if (r !== "pending") ops++;
    if (r === "restored") trace(`restored ${e.kind} at ${e.k}`);
  }
}

/** Drop an entry without touching the block (the block is gone or now belongs to the player). */
function drop(e, how, player) {
  if (entries.get(e.k) !== e) return; // already released (events can arrive twice)
  entries.delete(e.k);
  dirty = true;
  emit("ledger", { what: how, kind: e.kind, x: e.x, y: e.y, z: e.z, enc: e.enc, player: player ? player.name : "" });
  for (const cb of releaseListeners) safe(() => cb(e, how, player));
}

/** Force-restore everything (dev command / disabling the add-on). */
export function restoreAll() {
  let restored = 0, pending = 0;
  for (const e of [...entries.values()]) {
    const r = restore(e);
    if (r === "restored") restored++;
    if (r === "pending") pending++;
  }
  return { restored, pending };
}

// ---------------------------------------------------------------- player interaction with ledger blocks

export function registerEvents() {
  // Observer-placed blocks never drop items: cancel the break and remove/restore the block ourselves.
  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    const d = dimIndex(ev.dimension.id);
    const e = entries.get(blockKey(d, ev.block.location));
    if (!e) return;
    if (e.f & F.NODROP) {
      ev.cancel = true;
      const player = ev.player;
      system.run(() => {
        const dim = dimByIndex(e.d);
        const block = safe(() => dim.getBlock({ x: e.x, y: e.y, z: e.z }));
        if (block && holds(block, e.n)) safe(() => block.setPermutation(resolve(e.o)));
        drop(e, "broken", player);
      });
    } else {
      const player = ev.player;
      system.run(() => drop(e, "broken", player));
    }
  });
  // A player toggling a door / relighting a candle the Observer changed: their change wins.
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    if (!ev.isFirstEvent) return;
    const d = dimIndex(ev.block.dimension.id);
    const loc = ev.block.location;
    for (const dy of [0, 1, -1]) {
      const e = entries.get(blockKey(d, { x: loc.x, y: loc.y + dy, z: loc.z }));
      if (!e) continue;
      const player = ev.player;
      system.run(() => {
        const block = safe(() => dimByIndex(e.d).getBlock({ x: e.x, y: e.y, z: e.z }));
        if (!block) return;
        if (holds(block, e.o)) {
          syncLink(dimByIndex(e.d), e);
          drop(e, "player_restored", player);
        } else if (!holds(block, e.n)) drop(e, "player_changed", player);
      });
    }
  });
  // Placing a block where the Observer removed a light counts as relighting.
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    const d = dimIndex(ev.block.dimension.id);
    const e = entries.get(blockKey(d, ev.block.location));
    if (e) drop(e, /torch|lantern|candle|campfire/.test(ev.block.typeId) ? "player_restored" : "player_changed", ev.player);
  });
  world.afterEvents.blockExplode.subscribe((ev) => {
    const d = dimIndex(ev.dimension.id);
    const e = entries.get(blockKey(d, ev.block.location));
    if (e) drop(e, "exploded");
  });
}
