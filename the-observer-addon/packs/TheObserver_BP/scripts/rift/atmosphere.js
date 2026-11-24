// @ts-check
// The Rift's weather and its rules (1.6.0):
//   * its mist (fog observer:rift), on while you are in there, gone when you leave (or die there);
//   * rain that does not stop (particles round you that end on whatever they hit, so roofs keep it off; the sound of
//     it), embers drifting up from the ground, and lightning: a flash (Camera effects setting) and thunder;
//   * nothing lives there but it: any creature brought in (a mob on a lead, out of an egg or a spawner) is gone; what
//     is dropped, thrown or shot stays;
//   * the void: fall off the edge of the woods and the Rift puts you back at the stones.
import { world, system } from "@minecraft/server";
import { RIFT_ID, rift } from "./dimension.js";
import * as realm from "./realm.js";
import { S } from "../core/settings.js";
import { safe, emit, rand, allPlayers, V } from "../core/util.js";
import { now } from "../core/state.js";

/** @typedef {import("@minecraft/server").Player} Player */

const FOG = "observer:rift";
const FOG_ID = "observer_rift";
/** Players who have the Rift's mist on. @type {Set<string>} */
const misted = new Set();
/** When each player's next lightning comes (game seconds). @type {Map<string, number>} */
const boltAt = new Map();

/** @param {Player} p */
export const isIn = (p) => safe(() => p.dimension.id === RIFT_ID, false);

/** Into the Rift: its mist. @param {Player} p */
export function enter(p) {
  safe(() => p.runCommand(`fog @s remove ${FOG_ID}`));
  safe(() => p.runCommand(`fog @s push ${FOG} ${FOG_ID}`));
  misted.add(p.id);
  boltAt.set(p.id, now() + rand(6, 14));
}

/** Out of it. @param {Player} p */
export function leave(p) {
  if (misted.delete(p.id)) safe(() => p.runCommand(`fog @s remove ${FOG_ID}`));
  boltAt.delete(p.id);
}

/**
 * Lightning: thunder (near or far), and a flash of light (on the Camera effects setting). @param {Player} p
 * @param {number} [near] 0 far off .. 1 right overhead
 */
export function lightning(p, near = Math.random()) {
  if (!p.isValid) return;
  const l = p.location;
  const dir = V.fromYaw(rand(0, 360));
  const at = V.add(l, V.scale(dir, 30 - 24 * near));
  safe(() => p.playSound(near > 0.7 ? "ambient.weather.lightning.impact" : "ambient.weather.thunder", { location: { x: at.x, y: l.y + 10, z: at.z }, volume: 0.6 + 0.6 * near, pitch: rand(0.8, 1.05) }));
  if (S().camera >= 1) {
    const k = 0.45 + 0.5 * near;
    safe(() => p.camera.fade({ fadeColor: { red: 0.78 * k + 0.2, green: 0.74 * k + 0.2, blue: 0.95 * k + 0.05 }, fadeTime: { fadeInTime: 0.02, holdTime: 0.05 + 0.08 * near, fadeOutTime: 0.35 + 0.3 * near } }));
  }
  emit("rift", { what: "lightning", player: p.name, near: Math.round(near * 100) / 100 });
}

/** What may be in the Rift besides players and it: what is dropped, thrown or shot. */
const STAYS = /^minecraft:(item|xp_orb|xp_bottle|arrow|thrown_trident|snowball|egg|ender_pearl|splash_potion|lingering_potion|area_effect_cloud|fireworks_rocket|wind_charge_projectile|fishing_hook|tnt|falling_block|small_fireball|leash_knot|player)$/;

/** Every second. */
export function tick() {
  const d = rift();
  if (!d) return;
  const t = now();
  for (const p of allPlayers()) {
    const inside = isIn(p);
    if (!inside) {
      // (out of it — left, or died in there and woke at home)
      if (misted.has(p.id)) leave(p);
      continue;
    }
    if (!misted.has(p.id)) enter(p);
    const l = p.location;
    // the void: back to the stones
    if (l.y < realm.GROUND - 22 || !realm.within(l, 14)) {
      safe(() => p.teleport(realm.ARRIVE, { facingLocation: { x: realm.ARRIVE.x, y: realm.ARRIVE.y + 1, z: realm.ARRIVE.z + 10 } }));
      safe(() => p.addEffect("slow_falling", 60, { showParticles: false }));
      emit("rift", { what: "void_back", player: p.name });
      continue;
    }
    // the rain, and the sound of it; embers now and then
    safe(() => p.spawnParticle("observer:rift_rain", { x: l.x, y: l.y, z: l.z }));
    safe(() => p.playSound("ambient.weather.rain", { location: { x: l.x, y: l.y + 4, z: l.z }, volume: 0.35, pitch: rand(0.85, 1) }));
    if (Math.random() < 0.5) safe(() => p.spawnParticle("observer:rift_embers", { x: l.x, y: l.y, z: l.z }));
    if (t >= (boltAt.get(p.id) ?? 0)) {
      lightning(p, Math.random() * 0.8);
      boltAt.set(p.id, t + rand(14, 40));
    }
  }
  // nothing lives there but it
  for (const e of safe(() => d.getEntities(), []) ?? []) {
    const id = safe(() => e.typeId, "") ?? "";
    if (STAYS.test(id) || id.startsWith("observer:")) continue;
    emit("rift", { what: "removed", type: id });
    safe(() => e.remove());
  }
}

world.beforeEvents.playerLeave.subscribe((ev) => {
  const id = ev.player.id;
  system.run(() => {
    misted.delete(id);
    boltAt.delete(id);
  });
});
