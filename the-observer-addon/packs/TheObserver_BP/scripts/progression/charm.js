// @ts-check
// The charm of cold eyes (1.4.0). One of its puppets killed by you stays dead and leaves a cold eye
// (observer/puppets.js); four cold eyes on a string make a charm. Carried anywhere on you, it hums when one of its
// puppets is near — even one hiding among its kind — louder and higher the closer it is, and louder still when you
// face it: turn about with it and you can find the one that is its.
import { system, EquipmentSlot } from "@minecraft/server";
import * as puppets from "../observer/puppets.js";
import { ps, markPlayerDirty } from "../core/state.js";
import { V, safe, emit, allPlayers } from "../core/util.js";
import { ITEMS, SOUNDS } from "../core/constants.js";

/** @typedef {import("@minecraft/server").Player} Player */

const RANGE = 32;
/** player id -> tick of the next hum (or look) @type {Map<string, number>} */
const nextAt = new Map();
/** player id -> [tick checked, carries it] @type {Map<string, [number, boolean]>} */
const carried = new Map();

/** Does this player carry the charm (anywhere on them)? Looked at at most once a second. @param {Player} p @param {number} t */
function carries(p, t) {
  const c = carried.get(p.id);
  if (c && t - c[0] < 20) return c[1];
  let has = safe(() => p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Offhand)?.typeId === ITEMS.charm, false) ?? false;
  if (!has) {
    const inv = safe(() => p.getComponent("minecraft:inventory")?.container, undefined);
    if (inv) for (let i = 0; i < inv.size && !has; i++) has = safe(() => inv.getItem(i)?.typeId === ITEMS.charm, false) ?? false;
  }
  carried.set(p.id, [t, has]);
  return has;
}

/** Every 5 ticks. */
export function tick() {
  const t = system.currentTick;
  for (const p of allPlayers()) {
    if (t < (nextAt.get(p.id) ?? 0)) continue;
    if (!carries(p, t)) {
      nextAt.set(p.id, t + 20);
      continue;
    }
    const pp = puppets.nearest(p.dimension.id, p.location, RANGE, true);
    if (!pp) {
      nextAt.set(p.id, t + 20);
      continue;
    }
    const d = V.dist(pp.e.location, p.location);
    const near = 1 - d / RANGE;
    const to = V.norm(V.sub(safe(() => pp.e.getHeadLocation(), pp.e.location) ?? pp.e.location, p.getHeadLocation()));
    const view = safe(() => p.getViewDirection(), to) ?? to;
    const facing = 0.45 + 0.55 * Math.max(0, V.dot(to, view));
    const volume = Math.min(1, (0.2 + 0.7 * near) * facing);
    const pitch = 0.75 + 0.55 * near;
    safe(() => p.playSound(SOUNDS.charmHum, { volume, pitch }));
    nextAt.set(p.id, t + Math.round(10 + 30 * (d / RANGE)));
    emit("charm", { what: "hum", player: p.name, id: pp.id, d: Math.round(d * 10) / 10, volume: Math.round(volume * 100) / 100, quiet: pp.quiet });
    const s = ps(p);
    if (!s.charmHeard) {
      s.charmHeard = true;
      markPlayerDirty(p);
      safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.charm_hums" }] }));
    }
  }
}

/** @param {string} pid */
export function forget(pid) {
  nextAt.delete(pid);
  carried.delete(pid);
}
