// @ts-check
// E25 "At the Foot of the Bed" (1.1.1) — sleep paralysis. Now and then (stage 3+, about one night in three when it
// is free to come, and never twice within 90 minutes of play) a player who lies down does not sleep through. Just as
// sleep takes them the dark comes down, and they wake in the night unable to move: lying in bed, the room dim, their
// own heart loud — and it is standing at the foot of the bed, bent under the ceiling, looking at them. They try to
// turn their head and cannot. It tilts its head. It leans a little closer. They blink, and it is gone: they can move
// again, standing beside the bed, looking at where it stood. That is all it does — no damage, no sting, no sound
// but its breath. They woke, so the night is not skipped; they can lie down again.
// How: the sleeper is woken (a teleport wakes a sleeping player) behind a fade to black, their movement and camera
// are locked, the HUD is hidden and the view is a fixed camera at the pillow; a second, short fade hands it all back.
// If the game stops in the middle, everything is handed back when they next join. Never with camera effects off.
import { system, world, InputPermissionCategory, HudVisibility, EasingType, BlockVolume } from "@minecraft/server";
import { register, tryManual } from "../director/director.js";
import * as body from "../observer/body.js";
import { ps } from "../core/state.js";
import { S } from "../core/settings.js";
import { V, safe, emit, DEBUG } from "../core/util.js";
import { SOUNDS } from "../core/constants.js";
import { standAt } from "../world/space.js";
import { lineOfSight } from "../world/sight.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {{head:Vec, foot:Vec}} Bed  block cells */
/** @typedef {{cam:Vec, yaw:number, pitch:number, feet:Vec, stoop:boolean, top:Vec}} Scene */

const BED = "minecraft:bed";
/** What is taken from them while it lasts (and given back exactly as it was). */
const LOCKED = [InputPermissionCategory.Camera, InputPermissionCategory.Movement, InputPermissionCategory.Jump, InputPermissionCategory.Sneak];
/** Written the moment they are locked, so a crash or a quit in the middle can never leave them stuck. */
const HELD = "observer:paralysis";
/** Heads of the two body heights (stooped under a low ceiling, upright). */
const HEAD = { stoop: 2.45, up: 3.62 };

/** A bed cell's partner: the other half of the same bed. @param {import("@minecraft/server").Dimension} dim @param {Vec} c */
function partner(dim, c, wantHead) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = safe(() => dim.getBlock({ x: c.x + dx, y: c.y, z: c.z + dz }));
    if (b?.typeId === BED && !!safe(() => b.permutation.getState("head_piece_bit"), false) === wantHead) return { x: c.x + dx, y: c.y, z: c.z + dz };
  }
  return undefined;
}

/**
 * The bed a player lies in, or the nearest one within reach. @param {Player} p @param {number} r
 * @returns {Bed|undefined}
 */
export function findBed(p, r) {
  const dim = p.dimension;
  const at = V.floor(p.location);
  const vol = new BlockVolume({ x: at.x - r, y: at.y - 2, z: at.z - r }, { x: at.x + r, y: at.y + 2, z: at.z + r });
  const cells = [];
  const list = safe(() => dim.getBlocks(vol, { includeTypes: [BED] }, true));
  if (list) for (const c of list.getBlockLocationIterator()) cells.push(c);
  cells.sort((a, b) => V.dist(a, at) - V.dist(b, at));
  for (const c of cells) {
    const isHead = !!safe(() => dim.getBlock(c)?.permutation.getState("head_piece_bit"), false);
    const head = isHead ? c : partner(dim, c, true);
    const foot = head && partner(dim, head, false);
    if (head && foot) return { head: { x: head.x, y: head.y, z: head.z }, foot: { x: foot.x, y: foot.y, z: foot.z } };
  }
  return undefined;
}

/**
 * Where its body stands and where the player's eyes are: the camera lies at the pillow looking down the bed, and
 * it stands beyond the foot (or a little to one side of it), 2.6-3.8 blocks away, in full view — or, in a room too
 * small for that, beside the bed, looking down at them. @param {import("@minecraft/server").Dimension} dim @param {Bed} bed
 * @returns {Scene|undefined}
 */
export function stage(dim, bed) {
  const out = V.flat(V.sub(bed.foot, bed.head));
  const side = { x: -out.z, y: 0, z: out.x };
  // their body is set down on the bed behind this point, so nothing of it is ever in view
  const cam = { x: bed.head.x + 0.5 + out.x * 0.45, y: bed.head.y + 0.85, z: bed.head.z + 0.5 + out.z * 0.45 };
  const tried = new Set();
  const spots = [];
  for (const d of [3.4, 3.0, 3.8, 2.6]) for (const l of [0, 0.7, -0.7, 1.3, -1.3]) spots.push([d, l]);
  // beside the bed, by their knees
  for (const d of [1.2, 0.6]) for (const l of [1.8, -1.8, 2.4, -2.4]) spots.push([d, l]);
  for (const [d, l] of spots) {
    const x = Math.floor(cam.x + out.x * d + side.x * l), z = Math.floor(cam.z + out.z * d + side.z * l);
    const key = `${x},${z}`;
    if (tried.has(key)) continue;
    tried.add(key);
    if ((x === bed.head.x && z === bed.head.z) || (x === bed.foot.x && z === bed.foot.z)) continue;
    const st = standAt(dim, x + 0.5, z + 0.5, bed.head.y + 1.5, 3);
    if (!st || Math.abs(st.loc.y - bed.head.y) > 1) continue;
    const feet = st.loc;
    const top = { x: feet.x, y: feet.y + (st.stoop ? HEAD.stoop : HEAD.up), z: feet.z };
    const chest = { x: feet.x, y: feet.y + (top.y - feet.y) * 0.6, z: feet.z };
    if (!lineOfSight(dim, cam, top).clear || !lineOfSight(dim, top, cam).clear || !lineOfSight(dim, cam, chest).clear) continue;
    // framed from the bed: its head near the top of the view, the foot of the bed at the bottom
    const h = V.hdist(cam, feet);
    const up = ((Math.atan2(top.y - cam.y, h) + Math.atan2(feet.y - cam.y, h)) / 2) * (180 / Math.PI) + 2;
    return { cam, yaw: V.yawTo(cam, feet), pitch: -Math.max(4, Math.min(24, up)), feet, stoop: st.stoop, top };
  }
  return undefined;
}

/** A floor cell beside the bed to stand them on when it is over. @param {import("@minecraft/server").Dimension} dim @param {Bed} bed */
function besideBed(dim, bed) {
  const out = V.flat(V.sub(bed.foot, bed.head));
  const side = { x: -out.z, y: 0, z: out.x };
  for (const c of [bed.head, bed.foot]) {
    for (const s of [1, -1]) {
      const x = c.x + Math.round(side.x * s), z = c.z + Math.round(side.z * s);
      const st = standAt(dim, x + 0.5, z + 0.5, c.y + 1.5, 3);
      if (st && Math.abs(st.loc.y - c.y) <= 1 && safe(() => dim.getBlock(V.floor(st.loc))?.typeId) !== BED) return st.loc;
    }
  }
  return undefined;
}

/** Take their movement, their camera and the HUD. @param {Player} p */
function lock(p) {
  const prev = LOCKED.map((c) => safe(() => p.inputPermissions.isPermissionCategoryEnabled(c), true) !== false);
  safe(() => p.setDynamicProperty(HELD, JSON.stringify(prev)));
  for (const c of LOCKED) safe(() => p.inputPermissions.setPermissionCategory(c, false));
  safe(() => p.onScreenDisplay.setHudVisibility(HudVisibility.Hide));
}

/** Give it all back, exactly as it was. Safe to call at any time. @param {Player} p */
export function release(p) {
  const held = safe(() => p.getDynamicProperty(HELD));
  if (typeof held !== "string") return false;
  /** @type {boolean[]} */
  let prev = [];
  try {
    prev = JSON.parse(held);
  } catch {}
  LOCKED.forEach((c, i) => safe(() => p.inputPermissions.setPermissionCategory(c, prev[i] !== false)));
  safe(() => p.camera.clear());
  safe(() => p.onScreenDisplay.setHudVisibility(HudVisibility.Reset));
  safe(() => p.setDynamicProperty(HELD, undefined));
  emit("paralysis", { what: "released", player: p.name });
  return true;
}

/** @param {Player} p @param {number} inS @param {number} hold @param {number} outS */
function fade(p, inS, hold, outS) {
  safe(() => p.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: inS, holdTime: hold, fadeOutTime: outS } }));
}

/** The view from the pillow; `dyaw`/`dpitch` a little off it, eased (they try to turn their head). */
function view(p, sc, dyaw = 0, dpitch = 0, ease = 0) {
  const o = { location: sc.cam, rotation: { x: sc.pitch + dpitch, y: sc.yaw + dyaw } };
  safe(() => p.camera.setCamera("minecraft:free", ease > 0 ? { ...o, easeOptions: { easeTime: ease, easeType: EasingType.InOutSine } } : o));
}

register({
  id: "paralysis",
  tier: 3,
  minStage: 3,
  needsBody: true,
  manual: true,
  reactNear: false,
  cooldown: 5400,
  weight: () => 1,
  prepare(enc) {
    if (S().camera < 1) return false;
    // in bed: the bed they lie in; from the Config Wheel: the nearest bed
    const bed = findBed(enc.p, enc.p.isSleeping ? 2 : 8);
    const sc = bed && stage(enc.dim, bed);
    if (!bed || !sc) return false;
    enc.data.bed = bed;
    enc.data.scene = sc;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    /** @type {Bed} */
    const bed = enc.data.bed;
    /** @type {Scene} */
    const sc = enc.data.scene;
    const asleep = safe(() => p.isSleeping, false);
    // the dark comes down as sleep takes them
    fade(p, 0.8, 2.2, 2.8);
    enc.emit("paralysis", { what: "dark", asleep });
    try {
      await enc.wait(16);
      // they wake, lying where they were: their body is set down on the bed, the view is from the pillow
      safe(() => p.teleport({ x: bed.head.x + 0.5, y: bed.head.y + 0.5625, z: bed.head.z + 0.5 }, { rotation: { x: 0, y: sc.yaw } }));
      lock(p);
      view(p, sc);
      const b = enc.spawnBody(sc.feet, { state: "stare", stoop: sc.stoop, silent: true, autoPeek: false, face: sc.cam });
      if (!b) return enc.result("deferred");
      // it looks at their eyes (at the pillow), not at where their body was set down
      b.faceTarget = false;
      body.faceTo(sc.cam);
      enc.emit("paralysis", { what: "woke", asleep, awake: !safe(() => p.isSleeping, false), cam: sc.cam, feet: sc.feet, stoop: sc.stoop,
        yaw: Math.round(sc.yaw), pitch: Math.round(sc.pitch), dist: Math.round(V.hdist(sc.cam, sc.feet) * 10) / 10, tod: safe(() => world.getTimeOfDay(), -1) });
      await enc.wait(44);
      // the room comes up slowly out of the dark; it breathes
      enc.sound(SOUNDS.breath, sc.top, 0.55, 0.8);
      await enc.wait(60);
      // they try to turn their head, and cannot
      const dir = Math.random() < 0.5 ? 1 : -1;
      view(p, sc, 5 * dir, -1.5, 0.9);
      enc.emit("paralysis", { what: "strain" });
      await enc.wait(18);
      view(p, sc, 0, 0, 1.3);
      await enc.wait(30);
      body.setState("tilt");
      await enc.wait(44);
      body.setState("stare");
      // it leans in: two-thirds of a block closer, slowly
      const from = { ...sc.feet };
      const to = V.add(from, V.scale(V.flat(V.sub(sc.cam, from)), 0.65));
      for (let i = 1; i <= 15; i++) {
        body.moveTo(V.lerp(from, to, i / 15));
        body.faceTo(sc.cam);
        await enc.wait(2);
      }
      await enc.wait(26);
      // a blink, and it is gone
      fade(p, 0.15, 0.7, 1.6);
      await enc.wait(4);
      body.despawn("blink");
      release(p);
      // standing beside the bed, looking at where it stood
      const stand = besideBed(enc.dim, bed);
      if (stand) safe(() => p.teleport(stand, { facingLocation: { x: sc.feet.x, y: sc.feet.y + 1.6, z: sc.feet.z } }));
      enc.result("woke", true);
      enc.discover("foot_of_the_bed");
      enc.emit("paralysis", { what: "over", beside: !!stand });
    } finally {
      // however it ends (the player left, it was switched off, an Undo), nothing is kept from them
      if (enc.ownsBody()) body.despawn("blink");
      if (p.isValid) release(p);
    }
  },
});

/** player id -> the tick they lay down, or -1 once it has been decided for this sleep */
const lying = new Map();

/**
 * Every 5 ticks per player: once they have been asleep 1.5 s (well before the night is skipped, at 5 s), it is
 * decided whether it comes. @param {Player} p
 */
export function watchSleep(p) {
  if (!safe(() => p.isSleeping, false)) {
    lying.delete(p.id);
    return;
  }
  const t = system.currentTick;
  const since = lying.get(p.id);
  if (since === undefined) {
    lying.set(p.id, t);
    return;
  }
  if (since < 0 || t - since < 30) return;
  lying.set(p.id, -1);
  if (S().camera < 1) return;
  const s = ps(p);
  const chance = 0.3 + 0.05 * Math.max(0, s.stage - 3);
  const hit = DEBUG.paralysis === "always" || (DEBUG.paralysis !== "never" && Math.random() < chance);
  emit("paralysis", { what: "roll", player: p.name, hit });
  if (hit) tryManual("paralysis", p);
}

/** On joining (or a script reload): anything left held from an interrupted paralysis is given back. @param {Player} p */
export function recover(p) {
  if (release(p)) emit("paralysis", { what: "recovered", player: p.name });
}
