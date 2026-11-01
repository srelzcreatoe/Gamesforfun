// @ts-check
// Its puppets (1.3.0). It can take a creature for its own — any creature, Minecraft's own or another add-on's — and
// use it: walk it where it wants, hold it still, set it lurking at the edge of your sight, turn it loose on you, and
// give it back afterwards as it was. Nothing of the other add-on is touched or read: it acts on the creature only in the
// world they share — where it stands, which way it faces, how fast it moves, the effects on it — and it notes on the
// creature itself (a property of its own) that it is its, so a creature still held when the game stopped is given back
// the next time it is loaded.
// How you know one is its: its eyes (two small cold glints in place of the creature's own); its wisps drifting off it,
// and crimson shreds when it moves; the way it moves — in twitches, and while it lurks only when you are not looking;
// its voice coming out of it now and then (groans, the crack of a neck, a whisper meant for you); your heart and its
// music when one is near; the animals and the other creatures keeping away from it — and the Witness Lens, through
// which one flares. When it lets one go, its eyes go out in a puff of shreds.
// What a puppet sees, it knows (shared senses): when one has you in sight, its next encounter comes sooner.
import { system, world } from "@minecraft/server";
import { S, aggression } from "../core/settings.js";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { V, safe, emit, rand, allPlayers, DEBUG } from "../core/util.js";
import { PARTICLES, SOUNDS } from "../core/constants.js";
import { visibility, lineOfSight } from "../world/sight.js";
import { clearAhead } from "../world/walk.js";
import { eyes, tearApart } from "./dominion.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */
/**
 * @typedef {Object} Puppet
 * @property {Entity} e
 * @property {string} id
 * @property {string} why          what it was taken for (marked, herald, guard, knock, bait, cow, among, night)
 * @property {Player|undefined} p  whom it is used on
 * @property {Vec} origin          where it was taken (it can be put back there)
 * @property {string} dimId
 * @property {number} until        tick it is given back at the latest
 * @property {"stand"|"walk"|"lurk"|"follow"|"hunt"|"free"} mode
 * @property {Vec} [to]            where it is walking to
 * @property {"stand"|"lurk"|"follow"|"hunt"|"free"} [after]  what it does once there
 * @property {Vec} [face]          what it faces while it stands (else the player)
 * @property {number} keep         how near it comes (lurk, follow)
 * @property {number} yaw
 * @property {number} voiceAt
 * @property {boolean} moving
 * @property {boolean} quiet       no wisps or shreds (among others of its kind it is not to stand out)
 * @property {boolean} home        put back where it was taken when it is given back
 * @property {Set<string>} fx      the effects it has put on the creature (only these are taken off again)
 * @property {number} sensedAt
 * @property {(pp:Puppet, how:string)=>void} [onRelease]
 */

/** The property it notes on a creature that is its. */
export const PROP = "observer:puppet";
const MAX = 32;

/** @type {Map<string, Puppet>} */
const puppets = new Map();

const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

export const isPuppet = (/** @type {Entity} */ e) => puppets.has(safe(() => e.id, "") ?? "");
export const get = (/** @type {string} */ id) => puppets.get(id);
export const all = () => [...puppets.values()].filter((pp) => pp.e.isValid);
/** Puppets that show themselves (not hidden among others of their kind), in a dimension. @param {string} dimId */
export const presences = (dimId) => all().filter((pp) => pp.dimId === dimId && !pp.quiet);
export const count = (/** @type {string} */ why) => all().filter((pp) => pp.why === why).length;

/**
 * Take a creature for its own. @param {Entity} e @param {string} why
 * @param {{p?:Player, mode?:Puppet["mode"], seconds?:number, keep?:number, quiet?:boolean, home?:boolean, face?:Vec,
 *          onRelease?:(pp:Puppet, how:string)=>void}} [o]
 * @returns {Puppet|undefined}
 */
export function take(e, why, o = {}) {
  if (!S().enabled || S().puppets === false || puppets.size >= MAX) return undefined;
  if (!e || !e.isValid || e.typeId === "minecraft:player" || e.typeId.startsWith("observer:") || puppets.has(e.id)) return undefined;
  const l = { ...e.location };
  /** @type {Puppet} */
  const pp = { e, id: e.id, why, p: o.p, origin: l, dimId: e.dimension.id, until: system.currentTick + Math.round((o.seconds ?? 60) * 20),
    mode: o.mode ?? "stand", keep: o.keep ?? 8, yaw: safe(() => e.getRotation().y, 0) ?? 0, voiceAt: system.currentTick + Math.round(rand(80, 200)),
    moving: false, quiet: !!o.quiet, home: !!o.home, fx: new Set(), sensedAt: 0, face: o.face, onRelease: o.onRelease };
  puppets.set(e.id, pp);
  safe(() => e.setDynamicProperty(PROP, JSON.stringify({ why, at: [Math.round(l.x * 10) / 10, Math.round(l.y * 10) / 10, Math.round(l.z * 10) / 10], d: pp.dimId })));
  // the moment it is taken: a crack, and its eyes open in it
  if (!pp.quiet) safe(() => e.dimension.playSound(SOUNDS.crack, l, { volume: 0.8, pitch: 0.9 }));
  eyes(e);
  if (o.p?.isValid) {
    const s = ps(o.p);
    s.puppets = s.puppets ?? { taken: 0, seen: 0, torn: 0 };
    s.puppets.taken++;
    markPlayerDirty(o.p);
  }
  emit("puppet", { what: "take", why, type: e.typeId, id: e.id, player: o.p?.name, x: l.x, y: l.y, z: l.z, mode: pp.mode });
  return pp;
}

/**
 * Give it back. how: "quiet" (its eyes go out in a puff of shreds), "home" (and it is put back where it was taken),
 * "torn_out" (the possession is torn out of it in a burst — the creature itself is unharmed), "torn" (the creature is
 * torn apart), "gone" (removed, unseen), "lost" (it no longer exists). @param {string} id @param {string} how
 */
export function release(id, how) {
  const pp = puppets.get(id);
  if (!pp) return;
  puppets.delete(id);
  const e = pp.e;
  if (e.isValid) {
    for (const fx of pp.fx) safe(() => e.removeEffect(fx));
    safe(() => e.setDynamicProperty(PROP, undefined));
    const l = { ...e.location };
    if (how === "torn") tearApart(e, `puppet_${pp.why}`);
    else if (how === "gone") safe(() => e.remove());
    else {
      safe(() => e.dimension.spawnParticle(how === "torn_out" ? PARTICLES.puppetBurst : PARTICLES.puppetShred, l));
      if (how === "torn_out") safe(() => e.dimension.playSound(SOUNDS.crack, l, { volume: 1 }));
      if ((how === "home" || pp.home) && how !== "torn_out" && V.dist(l, pp.origin) > 2) safe(() => e.teleport(pp.origin));
    }
  }
  emit("puppet", { what: "release", how, why: pp.why, type: safe(() => e.typeId, "?"), id, player: pp.p?.name });
  safe(() => pp.onRelease?.(pp, how));
}

/** Everything it holds is given back (switched off, or the world closing). @param {string} how */
export function releaseAll(how = "home") {
  for (const id of [...puppets.keys()]) release(id, how);
}

/** Set what a puppet does next. @param {Puppet} pp @param {Puppet["mode"]} mode @param {{to?:Vec, after?:Puppet["after"], keep?:number, face?:Vec}} [o] */
export function setMode(pp, mode, o = {}) {
  pp.mode = mode;
  if (o.to) pp.to = o.to;
  if (o.after) pp.after = o.after;
  if (o.keep !== undefined) pp.keep = o.keep;
  if (o.face) pp.face = o.face;
  pp.moving = false;
  if (mode === "hunt") {
    drop(pp, "slowness");
    drop(pp, "weakness");
  }
  emit("puppet", { what: "mode", mode, why: pp.why, id: pp.id });
}

/** Put it somewhere at once (unseen). @param {Puppet} pp @param {Vec} loc @param {Vec} [face] */
export function place(pp, loc, face) {
  if (!pp.e.isValid) return false;
  const ok = !!safe(() => {
    pp.e.teleport(loc, face ? { facingLocation: face } : undefined);
    return true;
  }, false);
  if (ok) {
    pp.yaw = safe(() => pp.e.getRotation().y, pp.yaw) ?? pp.yaw;
    emit("puppet", { what: "placed", why: pp.why, id: pp.id, x: loc.x, y: loc.y, z: loc.z });
  }
  return ok;
}

/** Every tick. */
export function tick() {
  if (!puppets.size) return;
  if (!S().enabled || S().puppets === false) return releaseAll("home");
  const t = system.currentTick;
  for (const pp of [...puppets.values()]) {
    if (!pp.e.isValid) {
      puppets.delete(pp.id);
      emit("puppet", { what: "release", how: "lost", why: pp.why, id: pp.id });
      safe(() => pp.onRelease?.(pp, "lost"));
      continue;
    }
    if (t >= pp.until) {
      release(pp.id, pp.home ? "home" : "quiet");
      continue;
    }
    step(pp, t);
  }
}

/** @param {Puppet} pp @param {number} t */
function step(pp, t) {
  const e = pp.e;
  const p = pp.p?.isValid && pp.p.dimension.id === e.dimension.id ? pp.p : undefined;
  // the tells: its eyes always; its wisps and, as it moves, its shreds (unless it is hiding among its kind)
  if (t % 10 === 0) eyes(e);
  if (!pp.quiet && t % 20 === 5) safe(() => e.dimension.spawnParticle(PARTICLES.puppetWisp, e.location));
  if (!pp.quiet && pp.moving && t % 8 === 0) safe(() => e.dimension.spawnParticle(PARTICLES.puppetShred, e.location));
  // its voice, out of the creature
  if (t >= pp.voiceAt) {
    pp.voiceAt = t + Math.round(rand(160, 320));
    if (!pp.quiet) voice(pp, p);
  }
  if (p && pp.mode !== "hunt") senses(pp, p, t);
  const eye = p ? p.getHeadLocation() : undefined;
  switch (pp.mode) {
    case "stand": {
      hold(pp, t);
      const look = pp.face ?? eye;
      if (look) turn(pp, V.yawTo(e.location, look), look);
      return;
    }
    case "free":
      if (t % 10 === 0) harmless(pp);
      return;
    case "walk": {
      const to = pp.to;
      if (!to) return setMode(pp, pp.after ?? "stand");
      if (t % 10 === 0) harmless(pp);
      drop(pp, "slowness");
      const want = V.yawTo(e.location, to);
      turn(pp, want);
      const dir = V.fromYaw(pp.yaw);
      if (V.hdist(e.location, to) < 1.3 || (t % 5 === 0 && !clearAhead(e, dir))) {
        emit("puppet", { what: "arrived", why: pp.why, id: pp.id, d: Math.round(V.hdist(e.location, to) * 10) / 10 });
        return setMode(pp, pp.after ?? "stand");
      }
      // in twitches, like it: a burst, a stop
      pp.moving = true;
      walk(pp, want, dir, t % 12 < 8 ? 0.13 : 0.02);
      return;
    }
    case "lurk":
    case "follow": {
      if (!p || !eye) return hold(pp, t);
      turn(pp, V.yawTo(e.location, p.location), eye);
      const d = V.hdist(e.location, p.location);
      let go = false;
      let dir = V.fromYaw(pp.yaw);
      if (pp.mode === "follow") {
        // keeps its distance: closer when they move off, back when they come near
        if (d > pp.keep + 4) go = true;
        else if (d < pp.keep - 1.5) {
          go = true;
          dir = V.scale(dir, -1);
        }
      } else if (t % 2 === 0) {
        // lurking: it moves only while they are not looking at it, never nearer than it keeps
        const mh = safe(() => e.getHeadLocation(), e.location) ?? e.location;
        const seen = visibility(p, e.location, { points: [mh, { x: e.location.x, y: e.location.y + 0.8, z: e.location.z }], fov: 40 }).points > 0;
        go = !seen && d > pp.keep + 0.3;
        pp.moving = go;
      } else go = pp.moving;
      if (go && clearAhead(e, dir)) {
        pp.moving = true;
        drop(pp, "slowness");
        if (t % 10 === 0) harmless(pp);
        walk(pp, V.yawTo({ x: 0, y: 0, z: 0 }, dir), dir, 0.12);
      } else {
        pp.moving = false;
        hold(pp, t);
      }
      return;
    }
    case "hunt": {
      // turned loose: stronger and faster than it is, and it cannot turn back — it is steered at them
      if (t % 20 === 0) {
        give(pp, "strength", 1);
        give(pp, "speed", 1);
        give(pp, "resistance", 0);
        give(pp, "fire_resistance", 0);
      }
      if (!p) return;
      pp.moving = true;
      const d = V.hdist(e.location, p.location);
      if (d > 2.5) {
        const want = V.yawTo(e.location, p.location);
        turn(pp, want, eye);
        walk(pp, want, V.fromYaw(pp.yaw), 0.17);
      }
    }
  }
}

/** Held still where it stands, and harmless. @param {Puppet} pp @param {number} t */
function hold(pp, t) {
  pp.moving = false;
  if (t % 10 === 0) {
    give(pp, "slowness", 7);
    harmless(pp);
  }
  const v = safe(() => pp.e.getVelocity(), undefined);
  if (v && (v.x || v.z)) safe(() => pp.e.applyImpulse({ x: -v.x, y: 0, z: -v.z }));
}
/** @param {Puppet} pp */
function harmless(pp) {
  give(pp, "weakness", 4);
  if (/creeper/.test(pp.e.typeId)) safe(() => pp.e.triggerEvent("minecraft:stop_exploding"));
}
/** @param {Puppet} pp @param {string} fx @param {number} amp */
function give(pp, fx, amp) {
  safe(() => pp.e.addEffect(fx, 30, { amplifier: amp, showParticles: false }));
  pp.fx.add(fx);
}
/** @param {Puppet} pp @param {string} fx */
function drop(pp, fx) {
  if (!pp.fx.has(fx)) return;
  safe(() => pp.e.removeEffect(fx));
  pp.fx.delete(fx);
}
/** @param {Puppet} pp @param {number} want @param {Vec} dir @param {number} speed */
function walk(pp, want, dir, speed) {
  if (Math.abs(wrap(want - pp.yaw)) > 35) return;
  const v = safe(() => pp.e.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  safe(() => pp.e.applyImpulse({ x: dir.x * speed - v.x, y: 0, z: dir.z * speed - v.z }));
}
/** @param {Puppet} pp @param {number} want @param {Vec} [look] */
function turn(pp, want, look) {
  pp.yaw += Math.max(-16, Math.min(16, wrap(want - pp.yaw)));
  const head = safe(() => pp.e.getHeadLocation(), pp.e.location) ?? pp.e.location;
  const pitch = look ? Math.max(-45, Math.min(45, V.pitchTo(head, look))) : 0;
  safe(() => pp.e.setRotation({ x: pitch, y: pp.yaw }));
}

/** Its voice, out of the creature: a groan, a neck cracking — or, to the one it is used on, a whisper. @param {Puppet} pp @param {Player|undefined} p */
function voice(pp, p) {
  const e = pp.e;
  const head = safe(() => e.getHeadLocation(), e.location) ?? e.location;
  const r = Math.random();
  if (p && r < 0.3 && V.dist(head, p.location) < 16) safe(() => p.playSound(SOUNDS.whisper, { location: head, volume: 0.7 }));
  else safe(() => e.dimension.playSound(r < 0.65 ? SOUNDS.voice : SOUNDS.crack, head, { volume: 0.8 }));
  emit("puppet", { what: "voice", id: pp.id, why: pp.why });
}

/**
 * What a puppet sees, it knows: with them in sight (within 24 blocks, in front of it, nothing between), its next
 * encounter comes sooner — at most once every 5 minutes per player. @param {Puppet} pp @param {Player} p @param {number} t
 */
function senses(pp, p, t) {
  if (t % 20 !== 0 || t - pp.sensedAt < 100) return;
  const head = safe(() => pp.e.getHeadLocation(), undefined);
  if (!head) return;
  const eye = p.getHeadLocation();
  if (V.dist(head, eye) > 24) return;
  const facing = V.fromYaw(pp.yaw);
  if (V.angle(facing, V.flat(V.sub(eye, head))) > 70 || !lineOfSight(p.dimension, head, eye).clear) return;
  pp.sensedAt = t;
  const s = ps(p);
  const c = now();
  if (c - (s.sensedAt ?? -1e9) < 300 && DEBUG.possess !== "always") return;
  s.sensedAt = c;
  s.nextAt = Math.min(s.nextAt, c + rand(15, 30));
  markPlayerDirty(p);
  emit("puppet", { what: "senses", id: pp.id, why: pp.why, player: p.name, d: Math.round(V.dist(head, eye) * 10) / 10 });
}

/**
 * The Witness Lens, held on one of its puppets: it flares — its eyes blaze and its shreds burst off it. @param {Player} p
 * @returns {boolean} one was seen
 */
export function lensOn(p) {
  const pp = all().find((x) => x.dimId === p.dimension.id && V.dist(x.e.location, p.location) < 64
    && visibility(p, x.e.location, { points: [safe(() => x.e.getHeadLocation(), x.e.location) ?? x.e.location], fov: 15 }).points > 0);
  if (!pp) return false;
  const l = pp.e.location;
  safe(() => pp.e.dimension.spawnParticle(PARTICLES.puppetBurst, l));
  for (let i = 0; i < 4; i++) system.runTimeout(() => pp.e.isValid && eyes(pp.e), i * 3);
  const s = ps(p);
  s.puppets = s.puppets ?? { taken: 0, seen: 0, torn: 0 };
  s.puppets.seen++;
  markPlayerDirty(p);
  emit("puppet", { what: "seen_through_the_lens", id: pp.id, why: pp.why, player: p.name });
  return true;
}

/**
 * Its puppets near a point are felt like it (the heartbeat, its music, the animals). @param {string} dimId @param {Vec} loc
 * @param {number} r @returns {Puppet|undefined}
 */
export function nearest(dimId, loc, r) {
  let best, bd = r;
  for (const pp of presences(dimId)) {
    const d = V.dist(pp.e.location, loc);
    if (d < bd) {
      best = pp;
      bd = d;
    }
  }
  return best;
}

/**
 * A creature it still held when the game stopped (or its chunk was unloaded) is given back as it is loaded again:
 * the effects it puts on its puppets are taken off and the note removed. @param {Entity} e
 */
export function recover(e) {
  if (!e?.isValid || puppets.has(e.id)) return false;
  const note = safe(() => e.getDynamicProperty(PROP), undefined);
  if (note === undefined) return false;
  for (const fx of ["slowness", "weakness", "strength", "speed", "resistance", "fire_resistance"]) safe(() => e.removeEffect(fx));
  safe(() => e.setDynamicProperty(PROP, undefined));
  emit("puppet", { what: "recovered", type: e.typeId, id: e.id });
  return true;
}

export function registerEvents() {
  world.afterEvents.entityLoad.subscribe((ev) => safe(() => recover(ev.entity)));
}

/** On a script start: every loaded creature it still had a note on. */
export function recoverLoaded() {
  let n = 0;
  for (const d of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    for (const e of safe(() => world.getDimension(d).getEntities({ excludeTypes: ["minecraft:player", "minecraft:item"] }), []) ?? []) if (recover(e)) n++;
  }
  return n;
}

/** Tests: forget every creature it holds without giving any back — as if the game had stopped (see recover). */
export function forgetAll() {
  const n = puppets.size;
  puppets.clear();
  return n;
}

/** For the dev command and the Config Wheel. */
export function status() {
  return all().map((pp) => `${pp.e.typeId}:${pp.why}/${pp.mode}`).join(" ") || "none";
}

/** May it turn its puppets on someone (the hunt)? @param {Player} p */
export const mayHunt = (p) => aggression() >= 2 && ps(p).stage >= 4;
