// @ts-check
// The Flare: something that scares it off. Crafted 8 at a time (glowstone dust, gunpowder, paper),
// thrown like a snowball. Where it lands it burns for 8 seconds: a real light (a temporary light
// block, recorded in the ledger and removed when the flare dies) and a hissing white glare.
// While it burns, the Observer within 16 blocks of it recoils and tears apart — even mid-attack,
// even mid-strike (a strike already winding up does no damage). Taiga shadows near it vanish.
// Each flare is used up. If it has learned to expect flares (see observer/learn.js), the first one
// in an encounter only makes it flinch back; the second still works.
import { world, system, BlockPermutation, GameMode } from "@minecraft/server";
import { ITEMS, PARTICLES } from "../core/constants.js";
import { V, safe, emit, trace } from "../core/util.js";
import * as ledger from "../world/ledger.js";
import * as body from "../observer/body.js";
import * as illusions from "../observer/illusions.js";
import { isReplaceable } from "../world/space.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */

export const FLARE_ENTITY = "observer:flare";
export const RADIUS = 16;
const BURN_TICKS = 160;
const FUSE_TICKS = 30; // it lights where it lands, or after 1.5 s in the air
const LIGHT = "minecraft:light_block_15";

/**
 * @typedef {Object} Flare
 * @property {Entity} e
 * @property {string} owner      player id
 * @property {import("@minecraft/server").Dimension} dim
 * @property {{x:number,y:number,z:number}} loc  last known position
 * @property {number} thrown     tick
 * @property {number} lit        tick it ignited (0 = still flying)
 * @property {any} [light]       ledger entry of its light block
 * @property {boolean} [landed]
 * @property {Set<number>} handled  encounters it has already acted on
 */

/** @type {Flare[]} */
const flares = [];
/** @type {Map<string, number>} player id -> tick of last throw */
const lastThrow = new Map();

/** @type {{onFlared:(encId:number, at:{x:number,y:number,z:number}, owner:Player|undefined)=>void}} */
let hooks = { onFlared: () => {} };

/** @param {Player} p */
function consumeOne(p) {
  if (safe(() => p.getGameMode(), GameMode.Survival) === GameMode.Creative) return true;
  const inv = p.getComponent("minecraft:inventory")?.container;
  if (!inv) return false;
  const slot = p.selectedSlotIndex;
  const it = inv.getItem(slot);
  if (!it || it.typeId !== ITEMS.flare) return false;
  if (it.amount <= 1) inv.setItem(slot, undefined);
  else {
    it.amount -= 1;
    inv.setItem(slot, it);
  }
  return true;
}

/** Throw a flare from the player's hand. @param {Player} p @returns {boolean} */
export function throwFlare(p) {
  const t = system.currentTick;
  if (t - (lastThrow.get(p.id) ?? -99) < 20) return false;
  if (!consumeOne(p)) return false;
  lastThrow.set(p.id, t);
  const dir = p.getViewDirection();
  const head = p.getHeadLocation();
  const start = V.add(head, V.scale(dir, 0.6));
  const e = safe(() => p.dimension.spawnEntity(FLARE_ENTITY, start, { initialPersistence: false }));
  if (!e) return false;
  const proj = safe(() => e.getComponent("minecraft:projectile"));
  if (proj) {
    safe(() => {
      proj.owner = p;
    });
    safe(() => proj.shoot(V.scale(dir, 1.1)));
  } else safe(() => e.applyImpulse(V.scale(dir, 1.1)));
  safe(() => p.dimension.playSound("random.bow", start, { volume: 0.6, pitch: 0.7 }));
  flares.push({ e, owner: p.id, dim: p.dimension, loc: start, thrown: t, lit: 0, handled: new Set() });
  emit("flare", { what: "thrown", player: p.name });
  return true;
}

/** Put a light block in the flare's cell (or an open one next to it). @param {Flare} f */
function placeLight(f) {
  const base = V.floor(f.loc);
  for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
    const cell = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
    const b = safe(() => f.dim.getBlock(cell));
    if (!b || !(b.isAir || isReplaceable(b))) continue;
    const entry = ledger.change(f.dim, cell, BlockPermutation.resolve(LIGHT), { enc: -1, kind: "flare", restoreIn: 12, ignoreWard: true, flags: ledger.F.NODROP });
    if (entry) return entry;
  }
  return undefined;
}

/** @param {Flare} f */
function ignite(f) {
  f.lit = system.currentTick;
  const l = f.e.isValid ? safe(() => f.e.location) : undefined;
  if (l) f.loc = l;
  f.light = placeLight(f);
  safe(() => f.dim.playSound("firework.blast", f.loc, { volume: 1, pitch: 0.8 }));
  safe(() => f.dim.playSound("random.fuse", f.loc, { volume: 0.8, pitch: 1.5 }));
  trace(`flare lit at ${V.str(f.loc)} light=${!!f.light}`);
  emit("flare", { what: "lit", x: f.loc.x, y: f.loc.y, z: f.loc.z, light: !!f.light });
}

/** @param {Flare} f */
function burnOut(f) {
  safe(() => f.e.isValid && f.e.remove());
  if (f.light) safe(() => ledger.restore(f.light));
  safe(() => f.dim.playSound("random.fizz", f.loc, { volume: 0.6 }));
  emit("flare", { what: "out" });
}

/** Light a flare right here (dev command / tests). @param {Player} owner @param {{x:number,y:number,z:number}} loc */
export function igniteAt(owner, loc) {
  const e = safe(() => owner.dimension.spawnEntity(FLARE_ENTITY, loc, { initialPersistence: false }));
  if (!e) return false;
  const f = { e, owner: owner.id, dim: owner.dimension, loc, thrown: system.currentTick, lit: 0, handled: new Set() };
  flares.push(f);
  ignite(f);
  return true;
}

/** Is a burning flare within range of this point? @param {string} dimId @param {{x:number,y:number,z:number}} loc */
export function glareAt(dimId, loc) {
  return flares.some((f) => f.lit && f.dim.id === dimId && V.dist(f.loc, loc) <= RADIUS);
}

/** Every 2 ticks: fly, light, burn, drive it off. */
export function tick() {
  if (flares.length === 0) return;
  const t = system.currentTick;
  for (const f of [...flares]) {
    if (!f.lit) {
      if (f.e.isValid) {
        const l = safe(() => f.e.location);
        if (l) f.loc = l;
        const v = safe(() => f.e.getVelocity(), { x: 1, y: 1, z: 1 }) ?? { x: 1, y: 1, z: 1 };
        const still = t - f.thrown > 4 && Math.hypot(v.x, v.y, v.z) < 0.03;
        if (f.landed || still || t - f.thrown >= FUSE_TICKS) ignite(f);
      } else ignite(f); // it hit something and was removed: light where it was
      continue;
    }
    if (t - f.lit >= BURN_TICKS) {
      flares.splice(flares.indexOf(f), 1);
      burnOut(f);
      continue;
    }
    if ((t - f.lit) % 4 === 0) safe(() => f.dim.spawnParticle(PARTICLES.flare, { x: f.loc.x, y: f.loc.y + 0.25, z: f.loc.z }));
    if ((t - f.lit) % 30 === 28) safe(() => f.dim.playSound("random.fuse", f.loc, { volume: 0.5, pitch: 1.6 }));
    // the glare
    // the glare: each flare acts once on each encounter's body (so a flinch is not followed by a
    // second hit from the same flare)
    const b = body.get();
    if (b && !b.repelled && !f.handled.has(b.enc) && b.e.dimension.id === f.dim.id && V.dist(b.e.location, f.loc) <= RADIUS) {
      f.handled.add(b.enc);
      const owner = f.dim.getPlayers().find((p) => p.id === f.owner);
      hooks.onFlared(b.enc, f.loc, owner);
    }
    illusions.dispel(f.dim.id, f.loc, RADIUS);
  }
}

/** Number of flares in the air or burning (tests, status). */
export const active = () => flares.length;

/** @param {{onFlared:(encId:number, at:{x:number,y:number,z:number}, owner:Player|undefined)=>void}} h */
export function registerEvents(h) {
  hooks = h;
  // a flare that lands lights at once
  world.afterEvents.projectileHitBlock.subscribe((ev) => {
    if (ev.projectile?.typeId !== FLARE_ENTITY) return;
    const f = flares.find((x) => x.e.id === ev.projectile.id);
    if (f && !f.lit) f.landed = true;
  });
  world.afterEvents.projectileHitEntity.subscribe((ev) => {
    if (ev.projectile?.typeId !== FLARE_ENTITY) return;
    const f = flares.find((x) => x.e.id === ev.projectile.id);
    if (f && !f.lit) {
      f.landed = true;
      f.loc = ev.location;
    }
  });
  // flares are never saved: a world reloaded with one in it simply drops it
  world.afterEvents.entityLoad.subscribe((ev) => {
    if (ev.entity.typeId === FLARE_ENTITY && !flares.some((f) => f.e.id === ev.entity.id)) safe(() => ev.entity.remove());
  });
}
