// @ts-check
// They know (1.1.1). Animals sense it before you do. When it comes — seen or not — the animals near it stop what
// they are doing and turn to face it, quite still, the nearest first and the rest a moment later, so it ripples
// through a herd rather than setting it off at once. After a while the grazing animals edge away from it, unhurried,
// a few blocks, then stop and look back at it; dogs stand their ground and growl at it, low; cats hiss and back
// off; one of a herd may call out. A tamed dog that growled at it whines once when it has gone. Each animal reacts
// once per appearance — at most eight at a time and twelve in all — and none goes more than a few blocks, never off
// a ledge or into water; a pet told to sit stays sitting. Watch the animals and they will show you where it is. Settings: "Animals sense it" (on).
import { system } from "@minecraft/server";
import * as body from "./body.js";
import { S } from "../core/settings.js";
import { V, safe, emit, allPlayers } from "../core/util.js";
import { borrowed } from "../encounters/borrowed_eyes.js";
import { clearAhead } from "../world/walk.js";
import * as puppets from "./puppets.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {{x:number,y:number,z:number}} Vec */
/**
 * @typedef {Object} Reaction
 * @property {Entity} e
 * @property {"herd"|"dog"|"cat"|"stare"} kind
 * @property {"wait"|"face"|"away"|"look"} phase
 * @property {number} next      tick the current phase ends (or, waiting, begins)
 * @property {number} yaw       the yaw it is turned to (turned a little each tick)
 * @property {number} wobble    how far off straight-away it goes (degrees)
 * @property {number} growls
 * @property {number} [growlAt]  tick of a dog's next growl
 * @property {boolean} slowed   held still by us (heavy slowness, no particles)
 * @property {boolean} tame
 */

const RADIUS = 20;
/** at a time, and in all per appearance (a big farm does not all go off at once) */
const MAX = 8;
const TOTAL = 12;
const HERD = new Set(["minecraft:cow", "minecraft:mooshroom", "minecraft:sheep", "minecraft:pig", "minecraft:goat", "minecraft:llama",
  "minecraft:trader_llama", "minecraft:horse", "minecraft:donkey", "minecraft:mule", "minecraft:camel", "minecraft:chicken", "minecraft:rabbit",
  "minecraft:fox", "minecraft:armadillo"]);
const DOGS = new Set(["minecraft:wolf"]);
const CATS = new Set(["minecraft:cat", "minecraft:ocelot"]);
/** They only turn and look. */
const STARE = new Set(["minecraft:villager_v2"]);
/** One call from a herd, now and then. */
const CALL = { "minecraft:cow": "mob.cow.say", "minecraft:mooshroom": "mob.cow.say", "minecraft:sheep": "mob.sheep.say", "minecraft:pig": "mob.pig.say",
  "minecraft:goat": "mob.goat.ambient", "minecraft:horse": "mob.horse.angry", "minecraft:donkey": "mob.horse.donkey.angry", "minecraft:mule": "mob.horse.donkey.angry",
  "minecraft:llama": "mob.llama.angry", "minecraft:trader_llama": "mob.llama.angry" };
/** Blocks per tick when they edge away (a calm walk; the small ones scurry). */
const SPEED = { "minecraft:chicken": 0.1, "minecraft:rabbit": 0.11, "minecraft:fox": 0.1, "minecraft:cat": 0.09, "minecraft:ocelot": 0.09, "minecraft:horse": 0.085 };

/** @type {Map<string, Reaction>} */
const active = new Map();
/** the appearance (its body's encounter, or one of its puppets) the reactions belong to */
let appearance = "";
/** animals that have already reacted to this appearance */
const reacted = new Set();
let calls = 0;
/** tamed dogs to whine once it has gone @type {{e:Entity, at:number}[]} */
const whines = [];

const kindOf = (/** @type {string} */ id) => (HERD.has(id) ? "herd" : DOGS.has(id) ? "dog" : CATS.has(id) ? "cat" : STARE.has(id) ? "stare" : undefined);
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * What they sense: its body — or, with it nowhere, one of its puppets near someone (1.3.0: they know those too).
 * @returns {{key:string, e:Entity}|undefined}
 */
function presence() {
  const b = body.get();
  if (b) return { key: `body:${b.enc}`, e: b.e };
  for (const p of allPlayers()) {
    const pp = puppets.nearest(p.dimension.id, p.location, 48);
    if (pp) return { key: `puppet:${pp.id}`, e: pp.e };
  }
  return undefined;
}

/** Every tick. */
export function tick() {
  const t = system.currentTick;
  const src = presence();
  if (!src || !(S().enabled && S().animals !== false)) {
    if (active.size) settle(src ? "off" : "gone", t);
    if (whines.length) whine(t);
    return;
  }
  if (src.key !== appearance) {
    if (active.size) settle("new", t);
    appearance = src.key;
    reacted.clear();
    calls = 0;
  }
  const at = src.e.location;
  if (t % 10 === 0) scan(src.e, at, t);
  for (const r of active.values()) step(r, at, t);
}

/** New animals near it. @param {Entity} e @param {Vec} at @param {number} t */
function scan(e, at, t) {
  if (active.size >= MAX || reacted.size >= TOTAL) return;
  const dim = e.dimension;
  // only where someone is near enough to see it
  if (!allPlayers().some((p) => p.dimension.id === dim.id && V.dist(p.location, at) < 64)) return;
  const near = (safe(() => dim.getEntities({ location: at, maxDistance: RADIUS }), []) ?? [])
    .filter((m) => kindOf(m.typeId) && !reacted.has(m.id) && !borrowed.has(m.id) && !ridden(m) && safe(() => m.getDynamicProperty("observer:puppet"), undefined) === undefined)
    .sort((a, b) => V.dist(a.location, at) - V.dist(b.location, at))
    .slice(0, Math.min(MAX - active.size, TOTAL - reacted.size));
  for (const m of near) {
    reacted.add(m.id);
    const d = V.dist(m.location, at);
    active.set(m.id, { e: m, kind: /** @type {Reaction["kind"]} */ (kindOf(m.typeId)), phase: "wait", next: t + Math.round(6 + d * 1.5 + rand(0, 16)),
      yaw: safe(() => m.getRotation().y, 0) ?? 0, wobble: rand(-25, 25), growls: 0, slowed: false, tame: !!safe(() => m.hasComponent("minecraft:is_tamed"), false) });
  }
}

/** Someone is riding it: it is theirs to steer. @param {Entity} m */
const ridden = (m) => (safe(() => m.getComponent("minecraft:rideable")?.getRiders().length, 0) ?? 0) > 0;

/** @param {Reaction} r @param {Vec} at @param {number} t */
function step(r, at, t) {
  const m = r.e;
  if (!m.isValid) {
    for (const [k, v] of active) if (v === r) active.delete(k);
    return;
  }
  if (r.phase === "wait") {
    if (t < r.next) return;
    // it has sensed it: it turns to it and goes still
    r.phase = "face";
    r.next = t + Math.round(r.kind === "dog" ? 400 : r.kind === "cat" ? rand(25, 40) : /chicken|rabbit/.test(m.typeId) ? rand(20, 40) : rand(40, 80));
    hold(r);
    const d = Math.round(V.dist(m.location, at) * 10) / 10;
    let call;
    if (r.kind === "dog") growl(r);
    else if (r.kind === "cat") sound(m, (call = "mob.cat.hiss"), 0.8, rand(0.9, 1));
    else if (r.kind === "herd" && calls < 1 && CALL[m.typeId] && Math.random() < 0.5) {
      calls++;
      sound(m, (call = CALL[m.typeId]), 0.7, rand(0.75, 0.85));
    }
    emit("animals", { what: "notice", type: m.typeId, id: m.id, d, tame: r.tame, call });
    return;
  }
  if (r.phase === "face" || r.phase === "look") {
    turn(r, V.yawTo(m.location, at), at);
    if (t % 10 === 0) hold(r);
    // planted where it stands: no drifting, no being nudged along
    const v = safe(() => m.getVelocity(), undefined);
    if (v && (v.x || v.z)) safe(() => m.applyImpulse({ x: -v.x, y: 0, z: -v.z }));
    if (r.kind === "dog" && t >= (r.growlAt ?? 0) && r.growls < 3) growl(r);
    if (t < r.next) return;
    // grazing animals and cats edge away from it (most of them); the rest have looked long enough
    const goes = r.phase === "face" && (r.kind === "cat" || (r.kind === "herd" && Math.random() < 0.7)) && !leashed(m) && !sitting(m) && !safe(() => m.isInWater, false);
    if (goes) {
      r.phase = "away";
      r.next = t + Math.round(rand(40, 70));
      letGo(r);
      emit("animals", { what: "away", type: m.typeId, id: m.id });
    } else done(r, "looked");
    return;
  }
  // away: turn from it, then walk at a calm, steady pace (velocity held, not pushed)
  const away = V.yawTo(at, m.location) + r.wobble;
  turn(r, away);
  const dir = V.fromYaw(r.yaw);
  if (t >= r.next || (t % 5 === 0 && !clearAhead(m, dir))) {
    // it stops, and looks back at it
    r.phase = "look";
    r.next = t + Math.round(rand(40, 60));
    hold(r);
    emit("animals", { what: "look", type: m.typeId, id: m.id, moved: Math.round(V.hdist(m.location, at) * 10) / 10 });
    return;
  }
  if (Math.abs(wrap(away - r.yaw)) > 30) return;
  const v = safe(() => m.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  const sp = SPEED[m.typeId] ?? 0.075;
  safe(() => m.applyImpulse({ x: dir.x * sp - v.x, y: 0, z: dir.z * sp - v.z }));
}

/** Turn a little toward a yaw (never snapping round), looking up at it when it is close. @param {Reaction} r @param {number} want @param {Vec} [at] */
function turn(r, want, at) {
  const d = wrap(want - r.yaw);
  r.yaw += Math.max(-14, Math.min(14, d));
  const m = r.e;
  const pitch = at ? Math.max(-35, Math.min(10, V.pitchTo(safe(() => m.getHeadLocation(), m.location) ?? m.location, { x: at.x, y: at.y + 2.6, z: at.z }))) : 0;
  safe(() => m.setRotation({ x: pitch, y: r.yaw }));
}

/** Held still where it stands (heavy slowness, no particles; refreshed while it lasts). @param {Reaction} r */
function hold(r) {
  safe(() => r.e.addEffect("slowness", 30, { amplifier: 7, showParticles: false }));
  r.slowed = true;
}
/** @param {Reaction} r */
function letGo(r) {
  if (r.slowed) safe(() => r.e.removeEffect("slowness"));
  r.slowed = false;
}

/** @param {Reaction} r */
function growl(r) {
  r.growls++;
  r.growlAt = system.currentTick + Math.round(rand(60, 90));
  sound(r.e, "mob.wolf.growl", 0.9, rand(0.82, 0.92));
  emit("animals", { what: "growl", type: r.e.typeId, id: r.e.id, n: r.growls });
}

/** @param {Entity} m @param {string} id @param {number} volume @param {number} pitch */
function sound(m, id, volume, pitch) {
  safe(() => m.dimension.playSound(id, m.location, { volume, pitch }));
}

/** A pet told to sit stays sitting: it only turns and looks. @param {Entity} m */
const sitting = (m) => !!safe(() => m.hasComponent("minecraft:is_sitting"), false);
/** @param {Entity} m */
const leashed = (m) => !!safe(() => m.getComponent("minecraft:leashable")?.isLeashed, false);


/** @param {Reaction} r @param {string} why */
function done(r, why) {
  letGo(r);
  active.delete(r.e.id);
  emit("animals", { what: "done", type: r.e.typeId, id: r.e.id, why });
}

/** It is gone (or switched off): everything stops; a tamed dog that growled at it whines once. @param {string} why @param {number} t */
function settle(why, t) {
  for (const r of active.values()) {
    if (!r.e.isValid) continue;
    letGo(r);
    if (why === "gone" && r.kind === "dog" && r.tame && r.phase !== "wait") whines.push({ e: r.e, at: t + Math.round(rand(20, 50)) });
  }
  emit("animals", { what: "settle", why, n: active.size });
  active.clear();
}

/** @param {number} t */
function whine(t) {
  for (let i = whines.length - 1; i >= 0; i--) {
    const w = whines[i];
    if (t < w.at) continue;
    whines.splice(i, 1);
    if (!w.e.isValid) continue;
    sound(w.e, "mob.wolf.whine", 0.8, rand(0.95, 1.05));
    emit("animals", { what: "whine", type: w.e.typeId, id: w.e.id });
  }
}

/** For the dev command: what is reacting now. */
export function status() {
  return [...active.values()].map((r) => `${r.e.isValid ? r.e.typeId.replace("minecraft:", "") : "?"}:${r.phase}`).join(" ") || "none";
}
