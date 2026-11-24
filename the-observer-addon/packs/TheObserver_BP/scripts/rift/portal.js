// @ts-check
// The rift (1.6.0): a tear in the air, a tall oval of violet void full of stars, that opens near someone — anywhere,
// in any dimension — now and then, as often as the Config Wheel's Rift setting says (never, rarely … constantly).
// It grows from a crack while the realm on the other side is laid out afresh (scripts/rift/realm.js), stands open
// for two and a half minutes, glowing, sparking, humming, turning to face whoever is nearest, and then shuts.
// Walk into it and you are in the Rift, at the ring of stones; the way back is there, where you came in: walk into it
// and you are back where you left. Nobody is ever stranded: the way back stands open as long as anyone is in there.
import { world, system, GameMode, BlockPermutation } from "@minecraft/server";
import { riftReady, rift, RIFT_ID } from "./dimension.js";
import * as realm from "./realm.js";
import * as hunt from "./hunt.js";
import * as sky from "./atmosphere.js";
import * as talk from "../observer/talk.js";
import { discover } from "../progression/discoveries.js";
import { S } from "../core/settings.js";
import { SOUNDS, PARTICLES } from "../core/constants.js";
import { V, safe, emit, trace, rand, allPlayers, pick } from "../core/util.js";
import { W, now, markWorldDirty } from "../core/state.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {{x:number,y:number,z:number}} Vec */

export const PORTAL = "observer:rift_portal";
const EXIT_TAG = "observer_rift_exit";
const RECORD = "observer:rift_open";
const RETURN = "observer:rift_return";
/** Which laying-out of the realm a player went into (back after it was laid out again: to the stones). */
const GEN = "observer:rift_gen";
/** How long it stands open (seconds). */
export const OPEN_FOR = 150;
/** The Rift setting's average wait between rifts (minutes): never, rarely, sometimes, often, very often, constantly. */
export const EVERY = [0, 90, 45, 24, 12, 5];
const GROW = 6;

/**
 * The rift standing open in the world now (one at a time).
 * @typedef {{id:string, d:string, x:number, y:number, z:number, yaw:number, closeAt:number, openAt:number, lights:number[][], phase:number, by:string}} Open
 */
/** @type {Open|undefined} */
let open;
/** A rift on its way (the realm being laid out): the entity is there, growing. */
let opening = false;
/** Players just through (no bouncing back). @type {Map<string, number>} */
const justCrossed = new Map();

function save() {
  safe(() => world.setDynamicProperty(RECORD, open ? JSON.stringify(open) : undefined));
}
function load() {
  const s = safe(() => world.getDynamicProperty(RECORD));
  if (typeof s !== "string") return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** @param {string} id */
const dimOf = (id) => safe(() => world.getDimension(id));
/** The entity of the open rift, if it is loaded. */
function entityOf() {
  if (!open) return undefined;
  const d = dimOf(open.d);
  return d ? (safe(() => d.getEntities({ type: PORTAL, location: open, maxDistance: 4 }), []) ?? []).find((e) => !e.hasTag(EXIT_TAG)) : undefined;
}

// ---------------------------------------------------------------- light round it

/** Light where it stands (invisible light blocks in the air round its middle, taken away when it shuts). */
const LIGHT_IDS = ["minecraft:light_block_14", "minecraft:light_block_15"];
function lightPerm() {
  for (const id of LIGHT_IDS) {
    const p = safe(() => BlockPermutation.resolve(id));
    if (p) return p;
  }
  return safe(() => BlockPermutation.resolve("minecraft:light_block", { block_light_level: 14 }));
}
/** @param {Dimension} d @param {Vec} at @returns {number[][]} */
function light(d, at) {
  const perm = lightPerm();
  if (!perm) return [];
  const out = [];
  for (const [dx, dy, dz] of [[0, 2, 0], [0, 5, 0], [2, 1, 0], [-2, 1, 0], [0, 1, 2], [0, 1, -2]]) {
    const b = safe(() => d.getBlock({ x: Math.floor(at.x) + dx, y: Math.floor(at.y) + dy, z: Math.floor(at.z) + dz }));
    if (b?.isAir && safe(() => (b.setPermutation(perm), true), false)) out.push([b.x, b.y, b.z]);
  }
  return out;
}
/**
 * Its light taken away. Where that part of the world is not loaded now, the light is taken away the next time it is
 * (kept with the world). @param {Dimension|undefined} d @param {number[][]} cells
 */
function unlight(d, cells) {
  if (!d || !cells.length) return;
  const left = [];
  for (const [x, y, z] of cells) {
    if (!safe(() => d.isChunkLoaded({ x, y, z }), false)) {
      left.push([x, y, z]);
      continue;
    }
    const b = safe(() => d.getBlock({ x, y, z }));
    if (b && /light_block/.test(b.typeId)) safe(() => b.setType("minecraft:air"));
  }
  if (left.length) {
    const w = /** @type {any} */ (W);
    (w.riftUnlight ??= []).push([d.id, left]);
    markWorldDirty();
  }
}
/** Light left behind where it shut, taken away once that part of the world is loaded. */
function unlightLater() {
  const w = /** @type {any} */ (W);
  if (!w.riftUnlight?.length) return;
  const was = w.riftUnlight;
  w.riftUnlight = [];
  for (const [id, cells] of was) unlight(dimOf(id), cells);
  if (w.riftUnlight.length !== was.length || was.some((x, i) => x[1].length !== w.riftUnlight[i]?.[1].length)) markWorldDirty();
}

// ---------------------------------------------------------------- where it opens

/** What it can stand in (plants, snow, carpets, torches …) and what it cannot stand on. */
const PASSABLE = /(short_grass|tall_grass|fern|flower|bush|sapling|snow_layer|carpet|torch|vine|mushroom|sign|rail|button|pressure_plate|lever|web|tulip|orchid|allium|bluet|daisy|poppy|dandelion|cornflower|lily_of_the_valley|petals|roots|leaf_litter|wildflowers|stellar_grass|rift_fern|mooncap|bone_grass|bone_sprout|eyebloom|blood|corpse|skeleton|ritual_marking)/;
const SOLID_ENOUGH = (/** @type {string} */ id) => !/(leaves|fence|wall|glass_pane|iron_bars|door|trapdoor|slab|stairs|chest|bed|cactus|magma|campfire|fire|lava|powder_snow|scaffolding)/.test(id);

/** Open ground near them, room for it (three wide, seven high). @param {Player} p @returns {Vec|undefined} */
function placeFor(p) {
  const d = p.dimension;
  const l = p.location;
  const yaw = p.getRotation().y;
  for (let k = 0; k < 40; k++) {
    const dir = V.fromYaw(yaw + rand(-75, 75) + (k > 25 ? rand(-110, 110) : 0));
    const at = V.add(l, V.scale(dir, rand(8, 15)));
    const x = Math.floor(at.x), z = Math.floor(at.z);
    for (let y = Math.floor(l.y) + 4; y >= Math.floor(l.y) - 6; y--) {
      const g = safe(() => d.getBlock({ x, y, z }));
      if (!g || g.isAir || PASSABLE.test(g.typeId)) continue;
      if (g.isLiquid || !SOLID_ENOUGH(g.typeId)) break;
      let room = true;
      for (let dy = 1; dy <= 7 && room; dy++) {
        for (const [dx, dz] of dy <= 3 ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 0]]) {
          const b = safe(() => d.getBlock({ x: x + dx, y: y + dy, z: z + dz }));
          if (!b || !(b.isAir || PASSABLE.test(b.typeId))) {
            room = false;
            break;
          }
        }
      }
      if (room) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
      break;
    }
  }
  return undefined;
}

/** Can a rift come for this player? @param {Player} p */
function eligible(p) {
  const gm = safe(() => p.getGameMode());
  const hp = safe(() => p.getComponent("minecraft:health")?.currentValue, 0) ?? 0;
  return (gm === GameMode.Survival || gm === GameMode.Adventure) && hp > 0 && !sky.isIn(p) && !safe(() => p.isSleeping, false);
}

/**
 * Tear one open near this player. force: whatever the setting and the schedule (the Config Wheel's "open one now",
 * tests). @param {Player} p @param {{force?:boolean}} [o] @returns {Promise<string>}
 */
export async function openNear(p, o = {}) {
  if (!riftReady()) return "no rift dimension";
  if (open || opening) return "one is already open";
  if (!o.force && !eligible(p)) return "not now";
  const at = placeFor(p);
  if (!at) return "no room";
  const d = p.dimension;
  const yaw = V.yawTo(at, p.location);
  const e = safe(() => d.spawnEntity(PORTAL, at, { initialPersistence: true }));
  if (!e) return "could not open";
  opening = true;
  safe(() => e.setRotation({ x: 0, y: yaw }));
  safe(() => e.setProperty("observer:phase", 0));
  open = { id: e.id, d: d.id, x: at.x, y: at.y, z: at.z, yaw, closeAt: now() + OPEN_FOR + GROW, openAt: now() + GROW, lights: [], phase: 0, by: p.name };
  save();
  // the tear: a crack in the air, a burst, its sound
  safe(() => d.spawnParticle("observer:rift_burst", at));
  safe(() => d.spawnParticle(PARTICLES.glitchBurst, { x: at.x, y: at.y + 3, z: at.z }));
  safe(() => d.playSound(SOUNDS.crack, at, { volume: 1.2, pitch: 0.6 }));
  safe(() => d.playSound("portal.trigger", at, { volume: 1, pitch: 0.7 }));
  for (const q of allPlayers()) {
    if (q.dimension.id === d.id && V.dist(q.location, at) < 48) safe(() => q.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.rift.opened" }] }));
  }
  open.lights = light(d, at);
  save();
  trace(`rift opening near ${p.name} at ${V.str(at)} in ${d.id}`);
  emit("rift", { what: "opening", player: p.name, dim: d.id, x: at.x, y: at.y, z: at.z });
  // the other side, laid out afresh (unless someone is in there now — or it was never laid out at all)
  let ok = true;
  if (!realm.occupied() || !realm.current()) ok = await realm.build();
  const wait = Math.max(0, (open?.openAt ?? 0) - now());
  if (wait > 0) await system.waitTicks(Math.ceil(wait * 20));
  opening = false;
  if (!open) return "closed";
  if (!ok && !realm.current()) {
    close("failed");
    return "the other side could not be made";
  }
  open.phase = 1;
  safe(() => entityOf()?.setProperty("observer:phase", 1));
  save();
  emit("rift", { what: "open", player: p.name });
  return "open";
}

/** Shut the open rift. @param {string} why */
export function close(why) {
  if (!open) return;
  const o = open;
  open = undefined;
  save();
  const d = dimOf(o.d);
  const e = d ? (safe(() => d.getEntities({ type: PORTAL, location: o, maxDistance: 4 }), []) ?? []).find((x) => !x.hasTag(EXIT_TAG)) : undefined;
  unlight(d, o.lights);
  if (e) {
    safe(() => e.setProperty("observer:phase", 2));
    safe(() => d?.playSound("beacon.deactivate", o, { volume: 1, pitch: 0.6 }));
    safe(() => d?.playSound(SOUNDS.glitch, o, { volume: 0.8, pitch: 0.6 }));
    system.runTimeout(() => {
      safe(() => d?.spawnParticle("observer:rift_burst", o));
      safe(() => e.remove());
    }, 32);
  }
  emit("rift", { what: "closed", why });
}

// ---------------------------------------------------------------- through it, and back

/** Into the Rift. @param {Player} p */
export function enter(p) {
  const d = rift();
  if (!d || !open || open.phase < 1) return false;
  const back = { d: p.dimension.id, x: p.location.x, y: p.location.y, z: p.location.z };
  // (back out a step from the rift, facing away from it)
  const away = V.norm(V.flat(V.sub(p.location, open)));
  back.x += away.x * 2.5;
  back.z += away.z * 2.5;
  safe(() => p.setDynamicProperty(RETURN, JSON.stringify(back)));
  safe(() => p.setDynamicProperty(GEN, realm.current()?.gen ?? 0));
  realm.holdLanding(true);
  const ok = safe(() => {
    p.teleport(realm.ARRIVE, { dimension: d, facingLocation: { x: realm.ARRIVE.x, y: realm.ARRIVE.y + 1.5, z: realm.ARRIVE.z + 10 } });
    return true;
  }, false);
  if (!ok) return false;
  justCrossed.set(p.id, now());
  safe(() => p.camera.fade({ fadeColor: { red: 0.25, green: 0.05, blue: 0.4 }, fadeTime: { fadeInTime: 0, holdTime: 0.3, fadeOutTime: 1.2 } }));
  system.runTimeout(() => {
    if (!p.isValid) return;
    safe(() => p.playSound("mob.endermen.portal", { volume: 1, pitch: 0.5 }));
    safe(() => p.playSound(SOUNDS.presence, { volume: 0.7 }));
    sky.enter(p);
    hunt.arrived(p);
    discover(p, "the_rift");
    talk.react(p, "rift_arrive", 1);
  }, 4);
  emit("rift", { what: "enter", player: p.name, level: hunt.level() });
  return true;
}

/** Back out: to where they came in (or, not known, the world's spawn). @param {Player} p */
export function leave(p) {
  let back;
  try {
    back = JSON.parse(String(p.getDynamicProperty(RETURN) ?? ""));
  } catch {
    back = undefined;
  }
  const dim = (back && dimOf(back.d)) || world.getDimension("overworld");
  let to = back ? { x: back.x, y: back.y, z: back.z } : undefined;
  if (!to) {
    const sp = world.getDefaultSpawnLocation();
    to = { x: sp.x + 0.5, y: sp.y > 320 ? 100 : sp.y, z: sp.z + 0.5 };
  }
  const ok = safe(() => {
    p.teleport(to, { dimension: dim });
    return true;
  }, false);
  if (!ok) return false;
  justCrossed.set(p.id, now());
  safe(() => p.setDynamicProperty(RETURN, undefined));
  safe(() => p.setDynamicProperty(GEN, undefined));
  safe(() => p.camera.fade({ fadeColor: { red: 0.25, green: 0.05, blue: 0.4 }, fadeTime: { fadeInTime: 0, holdTime: 0.3, fadeOutTime: 1.2 } }));
  sky.leave(p);
  hunt.forget(p.id);
  if (!back?.d || back.d !== RIFT_ID) {
    // a moment of quiet before it is anywhere near them again
    system.runTimeout(() => {
      if (!p.isValid) return;
      safe(() => p.playSound("mob.endermen.portal", { volume: 0.8, pitch: 0.6 }));
      discover(p, "out_of_the_rift");
      talk.react(p, "rift_left", 1);
    }, 6);
  }
  emit("rift", { what: "leave", player: p.name, to: dim.id });
  return true;
}

/** The way out, at the stones: there while anyone is in the Rift. */
function exitPortal() {
  const d = rift();
  if (!d) return undefined;
  return (safe(() => d.getEntities({ type: PORTAL, tags: [EXIT_TAG], location: realm.EXIT, maxDistance: 6 }), []) ?? [])[0];
}
function ensureExit() {
  const d = rift();
  if (!d) return;
  realm.holdLanding(true);
  if (!safe(() => d.isChunkLoaded(realm.EXIT), false)) return;
  if (exitPortal()) return;
  const e = safe(() => d.spawnEntity(PORTAL, { x: realm.EXIT.x, y: realm.EXIT.y, z: realm.EXIT.z }, { initialPersistence: true }));
  if (!e) return;
  safe(() => e.addTag(EXIT_TAG));
  safe(() => e.setRotation({ x: 0, y: 0 }));
  safe(() => e.setProperty("observer:phase", 1));
  emit("rift", { what: "exit_ready" });
}

// ---------------------------------------------------------------- every few ticks

/** Through it? Facing whoever is nearest. Every 4 ticks. */
export function fastTick(run) {
  if (!riftReady()) return;
  const t = now();
  const ports = [];
  if (open && open.phase >= 1) {
    const e = entityOf();
    if (e) ports.push({ e, exit: false });
  }
  const x = exitPortal();
  if (x) ports.push({ e: x, exit: true });
  for (const { e, exit } of ports) {
    const at = e.location;
    let nearest;
    let best = 48;
    for (const p of allPlayers()) {
      if (p.dimension.id !== e.dimension.id) continue;
      const dd = V.dist(p.location, at);
      if (dd < best) {
        best = dd;
        nearest = p;
      }
      // through it: into its middle
      if (V.hdist(p.location, at) <= 1.5 && p.location.y > at.y - 1.5 && p.location.y < at.y + 4.5 && t - (justCrossed.get(p.id) ?? -1e9) > 3) {
        if (exit) leave(p);
        else if (S().enabled || p.dimension.id === RIFT_ID) enter(p);
      }
    }
    if (nearest && run % 3 === 0) {
      const want = V.yawTo(at, nearest.location);
      const cur = safe(() => e.getRotation().y, want) ?? want;
      const dy = ((((want - cur) % 360) + 540) % 360) - 180;
      safe(() => e.setRotation({ x: 0, y: cur + Math.max(-12, Math.min(12, dy)) }));
    }
  }
}

/** Every second: when the next one comes, open ones shutting, the way out kept, sounds. */
export function tick() {
  if (!riftReady()) return;
  const t = now();
  // the way out is there while anyone is in there (and goes when nobody is)
  if (realm.occupied()) ensureExit();
  else {
    const x = exitPortal();
    if (x) safe(() => x.remove());
    if (!realm.isBuilding()) realm.holdLanding(false);
  }
  if (Math.floor(t) % 10 === 0) unlightLater();
  if (open && !opening) {
    const e = entityOf();
    if (t >= open.closeAt) close("time");
    else if (e) {
      // its hum, its sparks
      if (Math.floor(t) % 3 === 0) safe(() => e.dimension.playSound("portal.portal", e.location, { volume: 0.7, pitch: 0.6 }));
      if (Math.floor(t) % 2 === 0) safe(() => e.dimension.spawnParticle(PARTICLES.glitchAura, { x: e.location.x, y: e.location.y + 2.5, z: e.location.z }));
    }
  }
  schedule(t);
}

/** The schedule: as often as the Rift setting says (randomly, about that often), near someone who can go. @param {number} t */
function schedule(t) {
  const lv = Math.round(Number(S().rift) || 0);
  if (!S().enabled || lv <= 0 || open || opening) return;
  const w = /** @type {any} */ (W);
  if (w.riftLevel !== lv || typeof w.riftNextAt !== "number") {
    w.riftLevel = lv;
    w.riftNextAt = t + EVERY[lv] * 60 * rand(0.6, 1.4);
    markWorldDirty();
    return;
  }
  if (t < w.riftNextAt) return;
  const who = allPlayers().filter(eligible);
  if (!who.length) return;
  w.riftNextAt = t + EVERY[lv] * 60 * rand(0.6, 1.4);
  markWorldDirty();
  const p = pick(who);
  openNear(p).then((r) => {
    // nowhere to stand it: try again soon
    if (r === "no room") {
      w.riftNextAt = now() + 30;
      markWorldDirty();
    }
  });
}

/** For the Config Wheel and tests: when the next one comes (seconds from now), and whether one is open. */
export function status() {
  const w = /** @type {any} */ (W);
  return { open: !!open, phase: open?.phase ?? -1, opening, next: typeof w.riftNextAt === "number" ? Math.round(w.riftNextAt - now()) : -1, at: open ? { d: open.d, x: open.x, y: open.y, z: open.z } : undefined };
}

/** The setting changed: the schedule starts again from now. */
export function reschedule() {
  const w = /** @type {any} */ (W);
  delete w.riftNextAt;
  markWorldDirty();
}

// ---------------------------------------------------------------- after a restart

world.afterEvents.worldLoad.subscribe(() => {
  system.runTimeout(() => {
    const was = load();
    if (!was) return;
    open = was;
    opening = false;
    // a rift still growing when the world stopped: open it now; one already past its time: shut it
    if (open && open.phase < 1) open.phase = 1;
    if (open && now() >= open.closeAt) close("restart");
    else save();
  }, 40);
});

// a player back in the world while in the Rift: its mist, its hunt
world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  system.runTimeout(() => {
    if (!p.isValid) return;
    if (sky.isIn(p)) {
      // the realm was laid out again while they were away: back to the stones (not inside whatever stands there now)
      const gen = safe(() => p.getDynamicProperty(GEN));
      if (gen !== (realm.current()?.gen ?? 0)) {
        safe(() => p.teleport(realm.ARRIVE, { facingLocation: { x: realm.ARRIVE.x, y: realm.ARRIVE.y + 1, z: realm.ARRIVE.z + 10 } }));
        safe(() => p.setDynamicProperty(GEN, realm.current()?.gen ?? 0));
      }
      sky.enter(p);
      hunt.arrived(p);
    } else sky.leave(p);
  }, 20);
});

/** For tests: walk this player into the open rift / out of the Rift at once. @param {Player} p */
export const testEnter = (p) => (open && open.phase >= 1 ? enter(p) : false);
export const testLeave = (p) => leave(p);
/** Any stray rift entities (not the open one, not the way out) are removed. */
export function sweep() {
  for (const id of ["overworld", "nether", "the_end", RIFT_ID]) {
    const d = dimOf(id);
    if (!d) continue;
    for (const e of safe(() => d.getEntities({ type: PORTAL }), []) ?? []) {
      if (e.hasTag(EXIT_TAG) ? !realm.occupied() && id === RIFT_ID : !(open && e.id === open.id)) {
        if (!(open && !e.hasTag(EXIT_TAG) && V.dist(e.location, open) < 4)) safe(() => e.remove());
      }
    }
  }
}
