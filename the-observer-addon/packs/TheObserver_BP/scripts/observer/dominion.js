// @ts-check
// It rules them (1.2.0). The other creatures of the dark — every hostile one, Minecraft's own or any other add-on's —
// answer to it. When it comes they know: the nearest first and the rest a moment later, they stop, turn to it and go
// still; then they back away from it, and once nobody is looking they are gone — it sends them away. The kinds you
// have marked as its rivals it tears apart. And it does not share: a creature that hurts you may find it standing
// behind it (encounters/not_yours.js).
// It takes nothing from another add-on: it acts on their creatures only through the world they share — finding them,
// turning them, holding them still, walking them, removing them.
// Left alone: players, its own kind, tamed or name-tagged creatures, Minecraft's bosses and anything with 300 or more
// health ("the great ones"), and every kind marked "leave it alone" (Config Wheel → Other creatures). At most twelve
// answer to it and four rivals fall per appearance. Settings: "Other creatures answer to it" (on).
import { system } from "@minecraft/server";
import * as body from "./body.js";
import { clearAhead } from "./animals.js";
import { S } from "../core/settings.js";
import { V, safe, emit, allPlayers } from "../core/util.js";
import { PARTICLES, SOUNDS } from "../core/constants.js";
import { seenByAny } from "../world/sight.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {{x:number,y:number,z:number}} Vec */
/**
 * @typedef {Object} Hold
 * @property {Entity} e
 * @property {"kin"|"rival"} as
 * @property {"wait"|"face"|"leave"|"hold"} phase
 * @property {number} next     tick the phase ends (waiting: begins)
 * @property {number} yaw
 * @property {number} wobble
 * @property {number} unseen   ticks out of everyone's sight
 */

const RADIUS = 24;
const MAX_KIN = 12;
const MAX_RIVALS = 4;
/** Minecraft's own great ones: never sent away. */
const BOSSES = new Set(["minecraft:ender_dragon", "minecraft:wither", "minecraft:warden", "minecraft:elder_guardian"]);
const CREEPERS = /creeper/;

/** @type {Map<string, Hold>} */
const held = new Map();
let appearance = -1;
const counted = new Set();
let kin = 0, rivals = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * What a creature is to it: "kin" (answers to it), "rival" (it tears it apart), or undefined (left alone).
 * @param {Entity} e
 * @returns {"kin"|"rival"|undefined}
 */
export function standing(e) {
  const id = safe(() => e.typeId, "") ?? "";
  if (!id || id === "minecraft:player" || id.startsWith("observer:") || id === "minecraft:item") return undefined;
  const mark = S().marks?.[id];
  if (mark === "ignore") return undefined;
  // someone named it, or it is someone's: not its to take
  if (safe(() => e.nameTag, "")) return undefined;
  if (safe(() => e.hasComponent("minecraft:is_tamed"), false)) return undefined;
  if (mark === "rival") return "rival";
  if (mark === "kin") return "kin";
  if (BOSSES.has(id)) return undefined;
  if ((safe(() => e.getComponent("minecraft:health")?.effectiveMax, 0) ?? 0) >= 300) return undefined;
  return safe(() => e.matches({ families: ["monster"] }), false) ? "kin" : undefined;
}

/** Every tick. */
export function tick() {
  const t = system.currentTick;
  const b = body.get();
  if (!b || !(S().enabled && S().creatures !== false)) {
    if (held.size) settle(b ? "off" : "gone");
    return;
  }
  if (b.enc !== appearance) {
    if (held.size) settle("new");
    appearance = b.enc;
    counted.clear();
    kin = rivals = 0;
  }
  const at = b.e.location;
  if (t % 10 === 0) scan(b.e, at, t);
  for (const h of held.values()) step(h, at, t);
}

/** @param {Entity} e @param {Vec} at @param {number} t */
function scan(e, at, t) {
  const dim = e.dimension;
  if (!allPlayers().some((p) => p.dimension.id === dim.id && V.dist(p.location, at) < 48)) return;
  const near = (safe(() => dim.getEntities({ location: at, maxDistance: RADIUS }), []) ?? [])
    .filter((m) => !counted.has(m.id))
    .sort((a, c) => V.dist(a.location, at) - V.dist(c.location, at));
  for (const m of near) {
    const as = standing(m);
    if (!as) continue;
    if (as === "kin" ? kin >= MAX_KIN : rivals >= MAX_RIVALS) continue;
    counted.add(m.id);
    if (as === "kin") kin++;
    else rivals++;
    const d = V.dist(m.location, at);
    held.set(m.id, { e: m, as, phase: "wait", next: t + Math.round((as === "rival" ? 4 : 6) + d * 1.2 + rand(0, 10)),
      yaw: safe(() => m.getRotation().y, 0) ?? 0, wobble: rand(-30, 30), unseen: 0 });
  }
}

/** @param {Hold} h @param {Vec} at @param {number} t */
function step(h, at, t) {
  const m = h.e;
  if (!m.isValid) {
    for (const [k, v] of held) if (v === h) held.delete(k);
    return;
  }
  if (h.phase === "wait") {
    if (t < h.next) return;
    // it knows what has come: it stops and turns to it
    h.phase = "face";
    h.next = t + Math.round(h.as === "rival" ? 12 : rand(20, 40));
    still(h);
    emit("dominion", { what: "notice", as: h.as, type: m.typeId, id: m.id, d: Math.round(V.dist(m.location, at) * 10) / 10 });
    return;
  }
  if (h.phase === "face" || h.phase === "hold") {
    turn(h, V.yawTo(m.location, at), at);
    if (t % 10 === 0) still(h);
    const v = safe(() => m.getVelocity(), undefined);
    if (v && (v.x || v.z)) safe(() => m.applyImpulse({ x: -v.x, y: 0, z: -v.z }));
    if (h.phase === "hold") {
      // backed away as far as it will go: it waits, quite still, until nobody is looking — then it is gone
      gone(h, t);
      return;
    }
    if (t < h.next) return;
    if (h.as === "rival") return tear(h, "rival");
    h.phase = "leave";
    h.next = t + Math.round(rand(50, 110));
    h.wobble = rand(-20, 20);
    letGo(h, false);
    emit("dominion", { what: "leave", type: m.typeId, id: m.id });
    return;
  }
  // leave: turned from it — and from whoever is near, never toward them — walking away at a held, unhurried pace
  const away = leaveYaw(m, at) + h.wobble;
  turn(h, away);
  if (t % 10 === 0) harmless(m);
  if (gone(h, t)) return;
  const dir = V.fromYaw(h.yaw);
  if (t >= h.next || (t % 5 === 0 && !clearAhead(m, dir))) {
    h.phase = "hold";
    still(h);
    emit("dominion", { what: "hold", type: m.typeId, id: m.id, d: Math.round(V.dist(m.location, at) * 10) / 10 });
    return;
  }
  if (Math.abs(wrap(away - h.yaw)) > 30) return;
  const v = safe(() => m.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  safe(() => m.applyImpulse({ x: dir.x * 0.1 - v.x, y: 0, z: dir.z * 0.1 - v.z }));
}

/** Out of everyone's sight for half a second: it is gone, quietly. @param {Hold} h @param {number} t @returns {boolean} */
function gone(h, t) {
  if (t % 2) return false;
  const m = h.e;
  const l = m.location;
  const pts = [{ x: l.x, y: l.y + 1, z: l.z }, { x: l.x, y: l.y + 1.7, z: l.z }, { x: l.x, y: l.y + 0.3, z: l.z }];
  const players = allPlayers().filter((p) => p.dimension.id === m.dimension.id);
  h.unseen = seenByAny(players, l, false, pts) ? 0 : h.unseen + 2;
  if (h.unseen < 10) return false;
  held.delete(m.id);
  emit("dominion", { what: "sent", type: m.typeId, id: m.id });
  safe(() => m.remove());
  return true;
}

/** A rival: torn apart where it stands, in its crimson shreds. @param {Hold} h @param {string} why */
function tear(h, why) {
  const m = h.e;
  held.delete(m.id);
  tearApart(m, why);
}

/**
 * Torn apart where it stands (also used by "Not Yours"). @param {Entity} m @param {string} why
 */
export function tearApart(m, why) {
  const l = safe(() => ({ ...m.location }), undefined);
  if (!l) return;
  const dim = m.dimension;
  const type = m.typeId;
  safe(() => dim.spawnParticle(PARTICLES.vanish, { x: l.x, y: l.y + 0.8, z: l.z }));
  safe(() => dim.playSound(SOUNDS.crack, l, { volume: 1 }));
  safe(() => dim.playSound(SOUNDS.vanish, l, { volume: 0.7, pitch: 1.2 }));
  safe(() => m.remove());
  emit("dominion", { what: "torn", why, type });
}

/** Turn a little toward a yaw, looking up at it when it is near. @param {Hold} h @param {number} want @param {Vec} [at] */
function turn(h, want, at) {
  const d = wrap(want - h.yaw);
  h.yaw += Math.max(-14, Math.min(14, d));
  const m = h.e;
  const pitch = at ? Math.max(-40, Math.min(10, V.pitchTo(safe(() => m.getHeadLocation(), m.location) ?? m.location, { x: at.x, y: at.y + 2.8, z: at.z }))) : 0;
  safe(() => m.setRotation({ x: pitch, y: h.yaw }));
}

/** The way out: away from it and from the nearest player (within 24 blocks) both. @param {Entity} m @param {Vec} at */
function leaveYaw(m, at) {
  const l = m.location;
  let dir = V.flat(V.sub(l, at));
  const p = allPlayers().filter((o) => o.dimension.id === m.dimension.id && V.dist(o.location, l) < 24)
    .sort((a, c) => V.dist(a.location, l) - V.dist(c.location, l))[0];
  if (p) dir = V.flat(V.add(dir, V.scale(V.flat(V.sub(l, p.location)), 1.3)));
  return V.yawTo({ x: 0, y: 0, z: 0 }, dir);
}

/** Held still where it stands (and harmless). @param {Hold} h */
function still(h) {
  safe(() => h.e.addEffect("slowness", 30, { amplifier: 7, showParticles: false }));
  harmless(h.e);
}
/** Harmless while it answers to it: too weak to hurt anyone, and a creeper's fuse put out. @param {Entity} m */
function harmless(m) {
  safe(() => m.addEffect("weakness", 30, { amplifier: 4, showParticles: false }));
  if (CREEPERS.test(m.typeId)) safe(() => m.triggerEvent("minecraft:stop_exploding"));
}
/** @param {Hold} h @param {boolean} all */
function letGo(h, all) {
  safe(() => h.e.removeEffect("slowness"));
  if (all) safe(() => h.e.removeEffect("weakness"));
}

/** It is gone (or switched off): those still waiting on it are let go. @param {string} why */
function settle(why) {
  for (const h of held.values()) if (h.e.isValid) letGo(h, true);
  emit("dominion", { what: "settle", why, n: held.size });
  held.clear();
}

/** For the dev command: what answers to it right now. */
export function status() {
  return [...held.values()].map((h) => `${h.e.isValid ? h.e.typeId : "?"}:${h.as}/${h.phase}`).join(" ") || "none";
}
