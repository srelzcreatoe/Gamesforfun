// @ts-check
// It rules them (1.2.0). The other creatures of the dark — every hostile one, Minecraft's own or any other add-on's —
// answer to it. When it comes they know: the nearest first and the rest a moment later, they stop, turn to it and go
// still; then they back away from it, and once nobody is looking they are gone — it sends them away. The kinds you
// have marked as its rivals it tears apart. And it does not share: a creature that hurts you may find it standing
// behind it (encounters/not_yours.js).
// 1.2.1 — they are its, and they serve it:
//   its watchers  from the third stage it keeps a few of them (three; four at the fifth): they go to stand around you,
//                 spread out at about ten blocks, and stare at you with its eyes, quite still, for as long as it is
//                 there; when it goes they stay a moment, and once nobody is looking they are gone too.
//   unwatched     from the fourth stage its watchers come closer only while you are not looking at them, like it
//                 does — never nearer than four blocks, and never able to hurt you.
//   its eyes      a creature that answers to it may be its eyes (encounters/its_eyes.js).
//   its rage      when it snaps (stage 4+, aggression Standard or High), the creatures it holds near you are let go
//                 with its eyes still in them, and come for you with it (unleash).
// It takes nothing from another add-on: it acts on their creatures only through the world they share — finding them,
// turning them, holding them still, walking them, removing them.
// Left alone: players, its own kind, tamed or name-tagged creatures, Minecraft's bosses and anything with 300 or more
// health ("the great ones"), and every kind marked "leave it alone" (Config Wheel → Other creatures). At most twelve
// answer to it and four rivals fall per appearance. Settings: "Other creatures answer to it" (on).
import { system } from "@minecraft/server";
import * as body from "./body.js";
import { clearAhead } from "../world/walk.js";
import { S, aggression } from "../core/settings.js";
import { ps } from "../core/state.js";
import { V, safe, emit, allPlayers } from "../core/util.js";
import { PARTICLES, SOUNDS } from "../core/constants.js";
import { seenByAny, visibility } from "../world/sight.js";
import { standNear } from "../world/space.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */
/**
 * @typedef {Object} Hold
 * @property {Entity} e
 * @property {"kin"|"rival"} as
 * @property {"send"|"watch"|"rival"} role   sent away / kept as one of its watchers / torn apart
 * @property {"wait"|"face"|"leave"|"hold"|"go"|"watch"|"dismiss"} phase
 * @property {number} next     tick the phase ends (waiting: begins)
 * @property {number} yaw
 * @property {number} wobble
 * @property {number} unseen   ticks out of everyone's sight
 * @property {Player} [p]      the player its watcher watches
 * @property {number} [slot]   which place around them
 * @property {Vec} [to]        where it is going to stand
 * @property {boolean} [moving] creeping closer (unwatched)
 */

const RADIUS = 24;
const MAX_KIN = 12;
const MAX_RIVALS = 4;
/** Where its watchers stand around the player, relative to the line from the player to it (degrees), and how far. */
const SLOTS = [70, -70, 140, -140];
const RING = 10;
const NEAREST = 4;
/** Minecraft's own great ones: never sent away. */
const BOSSES = new Set(["minecraft:ender_dragon", "minecraft:wither", "minecraft:warden", "minecraft:elder_guardian"]);
const CREEPERS = /creeper/;

/** @type {Map<string, Hold>} */
const held = new Map();
/** let go in its rage, its eyes still in them for a while @type {Map<string, {e:Entity, until:number}>} */
const unleashed = new Map();
let appearance = -1;
const counted = new Set();
let kin = 0, rivals = 0, watchers = 0;

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
  // left alone — or kept for its puppets (observer/possession.js), which it does not send away
  if (mark === "ignore" || mark === "puppet") return undefined;
  // someone named it, or it is someone's: not its to take
  if (safe(() => e.nameTag, "")) return undefined;
  if (safe(() => e.hasComponent("minecraft:is_tamed"), false)) return undefined;
  if (mark === "rival") return "rival";
  if (mark === "kin") return "kin";
  if (BOSSES.has(id)) return undefined;
  if ((safe(() => e.getComponent("minecraft:health")?.effectiveMax, 0) ?? 0) >= 300) return undefined;
  return safe(() => e.matches({ families: ["monster"] }), false) ? "kin" : undefined;
}

/** Is this creature held by it right now (watching, being sent away, ...)? @param {string} id */
export const isHeld = (id) => held.has(id);

/** Hooks main.js fills in: sent(where, dimension) when a creature is sent away unseen (tribute, 1.3.0). */
export const hooks = {
  /** @type {((at:Vec, dimId:string)=>void)|undefined} */ sent: undefined,
  /** its rage: those it let go hunt them as one (1.4.0) @type {((p:Player, ents:Entity[])=>number)|undefined} */ pack: undefined,
};

/** One of its puppets (observer/puppets.js notes that on the creature itself): those have their own orders. @param {Entity} e */
const puppet = (e) => safe(() => e.getDynamicProperty("observer:puppet"), undefined) !== undefined;

/** Every tick. */
export function tick() {
  const t = system.currentTick;
  const b = body.get();
  if (!(S().enabled && S().creatures !== false)) {
    if (held.size) settle("off");
    unleashed.clear();
    return;
  }
  if (unleashed.size && t % 10 === 0) {
    for (const [id, u] of unleashed) {
      if (!u.e.isValid || t > u.until) unleashed.delete(id);
      else eyes(u.e);
    }
  }
  if (!b) {
    // it has gone: its watchers stay a moment, the rest are let go
    if (held.size) dismiss(t);
    for (const h of held.values()) step(h, undefined, t);
    return;
  }
  if (b.enc !== appearance) {
    if (held.size) settle("new");
    appearance = b.enc;
    counted.clear();
    kin = rivals = watchers = 0;
  }
  const at = b.e.location;
  if (t % 10 === 0) scan(b, at, t);
  for (const h of held.values()) step(h, at, t);
}

/** @param {NonNullable<ReturnType<typeof body.get>>} b @param {Vec} at @param {number} t */
function scan(b, at, t) {
  const dim = b.e.dimension;
  const players = allPlayers().filter((p) => p.dimension.id === dim.id && V.dist(p.location, at) < 48);
  if (!players.length) return;
  // the one it came for (else whoever is nearest) is the one its watchers watch
  const target = b.target?.isValid && players.some((p) => p.id === b.target?.id) ? b.target
    : players.sort((a, c) => V.dist(a.location, at) - V.dist(c.location, at))[0];
  const stage = ps(target).stage;
  const keep = stage >= 5 ? 4 : stage >= 3 ? 3 : 0;
  const near = (safe(() => dim.getEntities({ location: at, maxDistance: RADIUS }), []) ?? [])
    .filter((m) => !counted.has(m.id) && !held.has(m.id) && !unleashed.has(m.id) && !puppet(m))
    .sort((a, c) => V.dist(a.location, at) - V.dist(c.location, at));
  for (const m of near) {
    const as = standing(m);
    if (!as) continue;
    if (as === "kin" ? kin >= MAX_KIN : rivals >= MAX_RIVALS) continue;
    counted.add(m.id);
    if (as === "kin") kin++;
    else rivals++;
    const d = V.dist(m.location, at);
    /** @type {Hold} */
    const h = { e: m, as, role: as === "rival" ? "rival" : "send", phase: "wait", next: t + Math.round((as === "rival" ? 4 : 6) + d * 1.2 + rand(0, 10)),
      yaw: safe(() => m.getRotation().y, 0) ?? 0, wobble: rand(-30, 30), unseen: 0 };
    if (as === "kin" && watchers < keep && V.dist(m.location, target.location) >= 5) {
      h.role = "watch";
      h.p = target;
      h.slot = watchers++;
    }
    held.set(m.id, h);
  }
}

/** @param {Hold} h @param {Vec|undefined} at its body (undefined once it has gone) @param {number} t */
function step(h, at, t) {
  const m = h.e;
  if (!m.isValid) {
    drop(h);
    return;
  }
  if (h.phase === "dismiss") {
    // it has gone; its watcher stays where it is, still and harmless, until nobody is looking — then it is gone too
    if (t % 10 === 0) still(h);
    if (!gone(h, t) && t >= h.next) {
      letGo(h, true);
      drop(h);
    }
    return;
  }
  if (!at) return;
  const head = { x: at.x, y: at.y + 2.8, z: at.z };
  if (h.phase === "wait") {
    if (t < h.next) return;
    // it knows what has come: it stops and turns to it
    h.phase = "face";
    h.next = t + Math.round(h.as === "rival" ? 12 : rand(20, 40));
    still(h);
    emit("dominion", { what: "notice", as: h.as, role: h.role, type: m.typeId, id: m.id, d: Math.round(V.dist(m.location, at) * 10) / 10 });
    return;
  }
  if (h.phase === "face" || h.phase === "hold") {
    turn(h, V.yawTo(m.location, at), head);
    if (t % 10 === 0) still(h);
    if (h.phase === "hold") {
      // backed away as far as it will go: it waits, quite still, until nobody is looking — then it is gone
      gone(h, t);
      return;
    }
    if (t < h.next) return;
    if (h.as === "rival") return tear(h, "rival");
    if (h.role === "watch") return take(h, at, t);
    h.phase = "leave";
    h.next = t + Math.round(rand(50, 110));
    h.wobble = rand(-20, 20);
    letGo(h, false);
    emit("dominion", { what: "leave", type: m.typeId, id: m.id });
    return;
  }
  if (h.phase === "go") return goTo(h, t);
  if (h.phase === "watch") return watch(h, t);
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
  walk(h, away, dir, 0.1);
}

// ---------------------------------------------------------------- its watchers

/** It takes this one for its own: a place around the player to stand and watch from. @param {Hold} h @param {Vec} at @param {number} t */
function take(h, at, t) {
  const m = h.e;
  const p = h.p;
  if (!p || !p.isValid || p.dimension.id !== m.dimension.id) {
    h.role = "send";
    h.phase = "hold";
    return;
  }
  const base = V.yawTo(p.location, at);
  const ang = base + SLOTS[(h.slot ?? 0) % SLOTS.length] + rand(-12, 12);
  const want = V.add(p.location, V.scale(V.fromYaw(ang), RING + rand(-1.5, 1.5)));
  const st = standNear(m.dimension, want.x, want.z, p.location.y);
  h.to = st && Math.abs(st.loc.y - p.location.y) < 4 ? st.loc : { ...m.location };
  h.phase = "go";
  h.next = t + 200;
  letGo(h, false);
  emit("dominion", { what: "take", type: m.typeId, id: m.id, slot: h.slot });
}

/** Walking to its place, its eyes in it. @param {Hold} h @param {number} t */
function goTo(h, t) {
  const m = h.e;
  const to = /** @type {Vec} */ (h.to);
  if (t % 10 === 0) {
    harmless(m);
    eyes(m);
  }
  const d = V.hdist(m.location, to);
  let want = V.yawTo(m.location, to);
  // it goes round them, never past them within reach
  const p = h.p;
  if (p?.isValid && V.hdist(m.location, p.location) < 4) {
    const toSlot = V.flat(V.sub(to, m.location));
    const away = V.flat(V.sub(m.location, p.location));
    want = V.yawTo({ x: 0, y: 0, z: 0 }, V.add(toSlot, V.scale(away, 1.6)));
  }
  turn(h, want);
  const dir = V.fromYaw(h.yaw);
  if (d < 1.2 || t >= h.next || (t % 5 === 0 && !clearAhead(m, dir))) {
    h.phase = "watch";
    still(h);
    emit("dominion", { what: "watching", type: m.typeId, id: m.id, d: p?.isValid ? Math.round(V.dist(m.location, p.location) * 10) / 10 : -1 });
    return;
  }
  walk(h, want, dir, 0.12);
}

/**
 * Standing in its place, staring at the player with its eyes. From the fourth stage it comes closer only while the
 * player is not looking at it, and never nearer than four blocks. @param {Hold} h @param {number} t
 */
function watch(h, t) {
  const m = h.e;
  const p = h.p;
  if (!p || !p.isValid || p.dimension.id !== m.dimension.id) {
    h.phase = "dismiss";
    h.next = t + 600;
    return;
  }
  const eye = p.getHeadLocation();
  turn(h, V.yawTo(m.location, p.location), eye);
  if (t % 10 === 0) {
    harmless(m);
    eyes(m);
  }
  const d = V.hdist(m.location, p.location);
  const creeps = ps(p).stage >= 4;
  if (creeps && t % 2 === 0) {
    const mh = safe(() => m.getHeadLocation(), m.location) ?? m.location;
    const seen = visibility(p, m.location, { points: [mh, { x: m.location.x, y: m.location.y + 0.8, z: m.location.z }], fov: 40 }).points > 0;
    const go = !seen && d > NEAREST + 0.3 && clearAhead(m, V.fromYaw(h.yaw));
    if (go !== !!h.moving) {
      h.moving = go;
      if (go) letGo(h, false);
      else still(h);
      emit("dominion", { what: go ? "creep" : "freeze", type: m.typeId, id: m.id, d: Math.round(d * 10) / 10 });
    }
  }
  if (h.moving) walk(h, h.yaw, V.fromYaw(h.yaw), 0.14);
  else {
    // held where it stands: its own wish to come for them is not its own any more
    if (t % 10 === 0) still(h);
    const v = safe(() => m.getVelocity(), undefined);
    if (d < NEAREST - 0.4) {
      // never nearer than that: it steps back
      const back = V.flat(V.sub(m.location, p.location));
      safe(() => m.applyImpulse({ x: back.x * 0.12 - (v?.x ?? 0), y: 0, z: back.z * 0.12 - (v?.z ?? 0) }));
    } else if (v && (v.x || v.z)) safe(() => m.applyImpulse({ x: -v.x, y: 0, z: -v.z }));
  }
}

/** It has gone: its watchers stay, still and harmless, until nobody is looking; everything else is let go. @param {number} t */
function dismiss(t) {
  let n = 0;
  for (const h of held.values()) {
    if (h.phase === "dismiss") continue;
    if (h.role === "watch" && h.e.isValid && h.phase !== "wait" && h.phase !== "face") {
      h.phase = "dismiss";
      h.next = t + 600;
      h.moving = false;
      still(h);
      n++;
      continue;
    }
    if (h.e.isValid) letGo(h, true);
    drop(h);
  }
  if (n) emit("dominion", { what: "dismiss", n });
}

/**
 * Its rage (stage 4+, aggression Standard or High): the creatures it holds near this player are let go, its eyes still
 * in them, and come for them with it. At most four. @param {Player} p
 * @returns {number} how many it let go
 */
export function unleash(p) {
  if (!S().enabled || S().creatures === false || aggression() < 2 || ps(p).stage < 4) return 0;
  const t = system.currentTick;
  let n = 0;
  /** @type {Entity[]} */
  const freed = [];
  for (const h of [...held.values()]) {
    if (n >= 4) break;
    if (h.role === "rival" || !h.e.isValid || h.e.dimension.id !== p.dimension.id || V.dist(h.e.location, p.location) > RADIUS) continue;
    letGo(h, true);
    drop(h);
    unleashed.set(h.e.id, { e: h.e, until: t + 200 });
    emit("dominion", { what: "unleash", type: h.e.typeId, id: h.e.id });
    freed.push(h.e);
    n++;
  }
  // and they do not just come: they hunt as one (1.4.0) — those it took for its pack wear its eyes as its puppets do
  if (freed.length && hooks.pack) {
    safe(() => hooks.pack?.(p, freed));
    for (const e of freed) if (puppet(e)) unleashed.delete(e.id);
  }
  return n;
}

// ---------------------------------------------------------------- shared

/** Out of everyone's sight for half a second: it is gone, quietly. @param {Hold} h @param {number} t @returns {boolean} */
function gone(h, t) {
  if (t % 2) return false;
  const m = h.e;
  const l = m.location;
  const pts = [{ x: l.x, y: l.y + 1, z: l.z }, { x: l.x, y: l.y + 1.7, z: l.z }, { x: l.x, y: l.y + 0.3, z: l.z }];
  const players = allPlayers().filter((p) => p.dimension.id === m.dimension.id);
  h.unseen = seenByAny(players, l, false, pts) ? 0 : h.unseen + 2;
  if (h.unseen < 10) return false;
  drop(h);
  // how far from it, when it went (it may go while still backing away, out of sight)
  const b = body.get();
  const d = b && b.e.dimension.id === m.dimension.id ? Math.round(V.dist(l, b.e.location) * 10) / 10 : undefined;
  emit("dominion", { what: "sent", type: m.typeId, id: m.id, role: h.role, d });
  safe(() => hooks.sent?.({ ...l }, m.dimension.id));
  safe(() => m.remove());
  return true;
}

/** @param {Hold} h */
function drop(h) {
  for (const [k, v] of held) if (v === h) held.delete(k);
}

/** A rival: torn apart where it stands, in its crimson shreds. @param {Hold} h @param {string} why */
function tear(h, why) {
  drop(h);
  tearApart(h.e, why);
}

/**
 * Torn apart where it stands (also used by "Not Yours" and "Its Eyes"). @param {Entity} m @param {string} why
 */
export function tearApart(m, why) {
  const l = safe(() => ({ ...m.location }), undefined);
  if (!l) return;
  const dim = m.dimension;
  const type = m.typeId;
  held.delete(m.id);
  safe(() => dim.spawnParticle(PARTICLES.vanish, { x: l.x, y: l.y + 0.8, z: l.z }));
  safe(() => dim.playSound(SOUNDS.crack, l, { volume: 1 }));
  safe(() => dim.playSound(SOUNDS.vanish, l, { volume: 0.7, pitch: 1.2 }));
  safe(() => m.remove());
  emit("dominion", { what: "torn", why, type });
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

/** Walk at a held, unhurried speed (blocks per tick) once facing roughly the way. @param {Hold} h @param {number} want @param {Vec} dir @param {number} speed */
function walk(h, want, dir, speed) {
  if (Math.abs(wrap(want - h.yaw)) > 30) return;
  const m = h.e;
  const v = safe(() => m.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  safe(() => m.applyImpulse({ x: dir.x * speed - v.x, y: 0, z: dir.z * speed - v.z }));
}

/** Turn a little toward a yaw, looking at a point when given. @param {Hold} h @param {number} want @param {Vec} [look] */
function turn(h, want, look) {
  const d = wrap(want - h.yaw);
  h.yaw += Math.max(-14, Math.min(14, d));
  const m = h.e;
  const pitch = look ? Math.max(-40, Math.min(30, V.pitchTo(safe(() => m.getHeadLocation(), m.location) ?? m.location, look))) : 0;
  safe(() => m.setRotation({ x: pitch, y: h.yaw }));
}

/** Held still where it stands (and harmless). @param {Hold} h */
function still(h) {
  safe(() => h.e.addEffect("slowness", 30, { amplifier: 7, showParticles: false }));
  harmless(h.e);
}
/** Harmless while it answers to it: too weak to hurt anyone, and a creeper's fuse put out. @param {Entity} m */
export function harmless(m) {
  safe(() => m.addEffect("weakness", 30, { amplifier: 4, showParticles: false }));
  if (CREEPERS.test(m.typeId)) safe(() => m.triggerEvent("minecraft:stop_exploding"));
}
/** @param {Hold} h @param {boolean} all */
function letGo(h, all) {
  safe(() => h.e.removeEffect("slowness"));
  if (all) safe(() => h.e.removeEffect("weakness"));
}

/** Its eyes, in a creature that is its: two small cold glints where its eyes are. @param {Entity} m */
export function eyes(m) {
  const head = safe(() => m.getHeadLocation(), undefined);
  if (!head) return;
  const f = V.fromYaw(safe(() => m.getRotation().y, 0) ?? 0);
  const side = { x: -f.z, y: 0, z: f.x };
  for (const k of [-1, 1]) {
    safe(() => m.dimension.spawnParticle(PARTICLES.servantEyes, { x: head.x + f.x * 0.3 + side.x * 0.12 * k, y: head.y + 0.03, z: head.z + f.z * 0.3 + side.z * 0.12 * k }));
  }
}

/** It is switched off (or a new appearance begins): everything it holds is let go. @param {string} why */
function settle(why) {
  let n = 0;
  for (const h of [...held.values()]) {
    if (why === "new" && h.phase === "dismiss") continue;
    if (h.e.isValid) letGo(h, true);
    drop(h);
    n++;
  }
  emit("dominion", { what: "settle", why, n });
}

/** For the dev command: what answers to it right now. */
export function status() {
  return [...held.values()].map((h) => `${h.e.isValid ? h.e.typeId : "?"}:${h.as}/${h.role}/${h.phase}`).join(" ") || "none";
}
