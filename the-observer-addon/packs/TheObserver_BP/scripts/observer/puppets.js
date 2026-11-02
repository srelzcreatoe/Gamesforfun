// @ts-check
// Its puppets (1.3.0; its hold, 1.4.0). It can take a creature for its own — any creature, Minecraft's own or another
// add-on's — and use it: walk it where it wants, hold it still, set it lurking at the edge of your sight, turn it loose
// on you, and give it back afterwards as it was. Nothing of the other add-on is touched or read: it acts on the creature
// only in the world they share — where it stands, which way it faces, how fast it moves, the effects on it, the harm
// done to it and by it — and it notes on the creature itself (a property of its own) that it is its, so a creature
// still held when the game stopped is given back the next time it is loaded.
// Its hold (1.4.0): nothing takes one of its puppets from it.
//   * The creature's own legs do nothing while it has it (its movement is switched off); it moves it itself
//     (observer/chase.js), so the creature's own mind cannot walk it off or turn it away.
//   * Moved by anything else — teleported away, to you, into another dimension — it is pulled straight back to where
//     it was, with a neck-crack and its shreds where it went. Pushed off where it stands, it is put back.
//   * Held means harmless: any harm to anyone from a creature it holds is undone before it lands — its blows, its
//     arrows, harm dealt in its name by whatever made it, and harm from nowhere right beside it. Only a puppet it
//     has turned loose (the hunt) can hurt you.
//   * Nothing but you can harm one of its puppets: not its own kind, not the fire, not whatever made it.
//   * It cannot be hidden from you: nothing can make it invisible while it is its.
//   * Taken back — deleted or killed by whatever made it — it brings it back: the same kind, where it was, its eyes
//     already in it. (Killed by you, it stays dead, and leaves a cold eye.)
//   * It learns each kind: those that fight its hold are held tighter from the first moment (their effects renewed
//     every other tick, pulled back from the smallest move); a kind taken back from it on the surface is kept below.
// How you know one is its: its eyes (two small cold glints in place of the creature's own); its wisps drifting off it,
// and crimson shreds when it moves; the way it moves — in twitches, and while it lurks only when you are not looking;
// its voice coming out of it now and then (groans, the crack of a neck, a whisper meant for you); your heart and its
// music when one is near; the animals and the other creatures keeping away from it — and the Witness Lens, through
// which one flares. When it lets one go, its eyes go out in a puff of shreds.
// What a puppet sees, it knows (shared senses): when one has you in sight, its next encounter comes sooner.
import { system, world, ItemStack } from "@minecraft/server";
import { S, aggression } from "../core/settings.js";
import { W, ps, now, markPlayerDirty, markWorldDirty } from "../core/state.js";
import { V, safe, emit, rand, DEBUG } from "../core/util.js";
import { PARTICLES, SOUNDS, ITEMS } from "../core/constants.js";
import { visibility, lineOfSight, viewAngle } from "../world/sight.js";
import { clearAhead } from "../world/walk.js";
import { eyes, tearApart, isHeld } from "./dominion.js";
import * as chase from "./chase.js";
import { discover } from "../progression/discoveries.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {import("../core/state.js").KindNote} KindNote */
/**
 * @typedef {Object} Puppet
 * @property {Entity} e
 * @property {string} id
 * @property {string} type          the kind of creature
 * @property {string} why           what it was taken for (marked, herald, guard, knock, bait, cow, among, night, pack, mirror, guide, procession, mine)
 * @property {Player|undefined} p  whom it is used on
 * @property {Vec} origin          where it was taken (it can be put back there)
 * @property {string} dimId
 * @property {number} until        tick it is given back at the latest
 * @property {"stand"|"walk"|"lurk"|"follow"|"hunt"|"free"|"mirror"|"lead"} mode
 * @property {Vec} [to]            where it is walking (or leading) to
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
 * @property {Vec} [at]            where it left it last tick (its hold: anything else moving it is undone)
 * @property {string} [atDim]
 * @property {Vec} [anchor]        where it stands, while it stands
 * @property {boolean} strict      a kind that fights its hold: held tighter
 * @property {number} crackAt
 * @property {number} foughtAt
 * @property {number[]} backs      ticks it brought this one back
 * @property {boolean} [revive]    being brought back right now
 * @property {any} [nav]           its route (observer/chase.js)
 * @property {"driver"|"cutter"|"blocker"} [role]  in its pack (its rage)
 * @property {string} [pack]
 * @property {Vec} [post]
 * @property {number} [postAt]
 * @property {boolean} [climbing]
 * @property {number} jumpAt
 * @property {boolean} [arrived]   a guide: it got where it was leading
 * @property {boolean} [waiting]   a guide: stopped, looking back for them
 * @property {boolean} [looked]    a mirror: they are looking at it
 */
/** @typedef {{type:string, loc:Vec, dimId:string, yaw:number, hp:number, name:string, why:string}} Snap */

/** The property it notes on a creature that is its. */
export const PROP = "observer:puppet";
const MAX = 32;
/** Its hold: moved further than this in a tick by anything else, it is pulled back. */
const JUMP = 2.0, JUMP_STRICT = 1.2;
/** Its hold: pushed off where it stands by more than this, it is put back. */
const DRIFT = 0.7, DRIFT_STRICT = 0.35;
/** Harm with no one behind it, right beside one of its held puppets, is undone: these causes. */
const NAMELESS = new Set(["entityAttack", "none", "override", "magic", "entityExplosion", "projectile", "charging", "ramAttack", "sonicBoom", "maceSmash", "wither", "thorns"]);

/** @type {Map<string, Puppet>} */
const puppets = new Map();
/** A creature it brought back answers to the old one's id too. @type {Map<string, Puppet>} */
const aliases = new Map();
/** Taken from it (deleted, killed): to be brought back. @type {Map<string, Snap>} */
const returning = new Map();

const wrap = (/** @type {number} */ d) => ((((d + 180) % 360) + 360) % 360) - 180;

export const isPuppet = (/** @type {Entity} */ e) => puppets.has(safe(() => e.id, "") ?? "");
/** @param {string} id */
export function get(id) {
  const pp = puppets.get(id);
  if (pp) return pp;
  const al = aliases.get(id);
  return al && puppets.get(al.id) === al ? al : undefined;
}
export const all = () => [...puppets.values()].filter((pp) => pp.e.isValid);
/** Puppets that show themselves (not hidden among others of their kind), in a dimension. @param {string} dimId */
export const presences = (dimId) => all().filter((pp) => pp.dimId === dimId && !pp.quiet);
export const count = (/** @type {string} */ why) => all().filter((pp) => pp.why === why).length;

// ---------------------------------------------------------------- what it has learned of each kind

/** @param {string} type @returns {KindNote} */
function kindNote(type) {
  W.kinds = W.kinds ?? {};
  return (W.kinds[type] = W.kinds[type] ?? { fights: 0, removed: 0, removedUp: 0, removedDown: 0, blocked: 0, back: 0 });
}
/** @param {string} type @param {keyof KindNote} what */
export function note(type, what) {
  if (!type) return;
  const k = kindNote(type);
  k[what]++;
  markWorldDirty();
  // a kind that fights its hold is held tighter, from now on and from the first moment
  if ((what === "fights" || what === "removed") && strict(type)) for (const pp of puppets.values()) if (pp.type === type && !pp.strict) {
    pp.strict = true;
    emit("puppet", { what: "held_tighter", type, id: pp.id });
  }
}
/** A kind that fights its hold. @param {string} type */
export const strict = (type) => {
  const k = W.kinds?.[type];
  return !!k && (k.fights >= 3 || k.removed >= 2);
};
/** A kind taken back from it whenever it is up on the surface: kept below. @param {string} type */
export const keepBelow = (type) => {
  const k = W.kinds?.[type];
  return !!k && k.removedUp >= 2 && k.removedUp > k.removedDown + 1;
};
/** Everything it has learned, for the Field Notes and the dev command. */
export const kinds = () => ({ ...(W.kinds ?? {}) });
/** Tests: forget what it has learned. */
export function forgetKinds() {
  W.kinds = {};
  markWorldDirty();
  for (const pp of puppets.values()) pp.strict = false;
}

// ---------------------------------------------------------------- taking and giving back

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
  const t = system.currentTick;
  /** @type {Puppet} */
  const pp = { e, id: e.id, type: e.typeId, why, p: o.p, origin: l, dimId: e.dimension.id, until: t + Math.round((o.seconds ?? 60) * 20),
    mode: o.mode ?? "stand", keep: o.keep ?? 8, yaw: safe(() => e.getRotation().y, 0) ?? 0, voiceAt: t + Math.round(rand(80, 200)),
    moving: false, quiet: !!o.quiet, home: !!o.home, fx: new Set(), sensedAt: 0, face: o.face, onRelease: o.onRelease,
    at: l, atDim: e.dimension.id, anchor: (o.mode ?? "stand") === "stand" ? l : undefined, strict: strict(e.typeId),
    crackAt: -1e9, foughtAt: -1e9, backs: [], jumpAt: -1e9 };
  puppets.set(e.id, pp);
  safe(() => e.setDynamicProperty(PROP, JSON.stringify({ why, at: [Math.round(l.x * 10) / 10, Math.round(l.y * 10) / 10, Math.round(l.z * 10) / 10], d: pp.dimId })));
  // it cannot be hidden from you: whatever hid it, it is seen again
  safe(() => e.removeEffect("invisibility"));
  // its legs are its now, from the first moment
  refresh(pp);
  // the moment it is taken: a crack, and its eyes open in it
  if (!pp.quiet) safe(() => e.dimension.playSound(SOUNDS.crack, l, { volume: 0.8, pitch: 0.9 }));
  eyes(e);
  if (o.p?.isValid) {
    const s = ps(o.p);
    s.puppets = s.puppets ?? { taken: 0, seen: 0, torn: 0 };
    s.puppets.taken++;
    markPlayerDirty(o.p);
  }
  emit("puppet", { what: "take", why, type: e.typeId, id: e.id, player: o.p?.name, x: l.x, y: l.y, z: l.z, mode: pp.mode, strict: pp.strict });
  return pp;
}

/**
 * Give it back. how: "quiet" (its eyes go out in a puff of shreds), "home" (and it is put back where it was taken),
 * "torn_out" (the possession is torn out of it in a burst — the creature itself is unharmed), "torn" (the creature is
 * torn apart), "gone" (removed, unseen), "lost" (it no longer exists). @param {string} id @param {string} how
 */
export function release(id, how) {
  const pp = get(id);
  if (!pp) return;
  puppets.delete(pp.id);
  returning.delete(pp.id);
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
      if ((how === "home" || pp.home) && how !== "torn_out" && (V.dist(l, pp.origin) > 2 || e.dimension.id !== pp.dimId)) {
        safe(() => e.teleport(pp.origin, { dimension: world.getDimension(originDim(pp)) }));
      }
    }
  }
  emit("puppet", { what: "release", how, why: pp.why, type: pp.type, id: pp.id, player: pp.p?.name });
  safe(() => pp.onRelease?.(pp, how));
}
/** The dimension it was taken in (from its note, else where it is). @param {Puppet} pp */
function originDim(pp) {
  const n = safe(() => JSON.parse(String(pp.e.getDynamicProperty(PROP) ?? "{}")).d, undefined);
  return n ?? pp.dimId;
}

/** Everything it holds is given back (switched off, or the world closing). @param {string} how */
export function releaseAll(how = "home") {
  for (const id of [...puppets.keys()]) release(id, how);
}

/** Set what a puppet does next. @param {Puppet} pp @param {Puppet["mode"]} mode @param {{to?:Vec, after?:Puppet["after"], keep?:number, face?:Vec}} [o] */
export function setMode(pp, mode, o = {}) {
  const was = pp.mode;
  pp.mode = mode;
  if (o.to) pp.to = o.to;
  if (o.after) pp.after = o.after;
  if (o.keep !== undefined) pp.keep = o.keep;
  if (o.face) pp.face = o.face;
  pp.moving = false;
  pp.anchor = mode === "stand" && pp.e.isValid ? { ...pp.e.location } : undefined;
  pp.arrived = false;
  if (mode === "hunt") {
    drop(pp, "weakness");
    pp.nav = chase.freshNav();
  } else if (was === "hunt") for (const fx of ["strength", "resistance", "fire_resistance"]) drop(pp, fx);
  if (mode === "free") drop(pp, "slowness");
  refresh(pp);
  emit("puppet", { what: "mode", mode, why: pp.why, id: pp.id, role: pp.role });
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
    pp.at = { ...loc };
    pp.atDim = pp.e.dimension.id;
    if (pp.mode === "stand") pp.anchor = { ...loc };
    if (pp.nav) pp.nav.plannedAt = -1e9;
    emit("puppet", { what: "placed", why: pp.why, id: pp.id, x: loc.x, y: loc.y, z: loc.z });
  }
  return ok;
}

// ---------------------------------------------------------------- every tick

/** A second look, at the end of the tick — after whatever else moves creatures in its scripts has had its turn. */
const LATE = "observer_hold:late";
/** Puppets something else has been moving lately get the second look. @param {Puppet} pp @param {number} t */
const watched = (pp, t) => pp.strict || t - pp.foughtAt < 200 || t - pp.crackAt < 200;
function lateLook() {
  const t = system.currentTick;
  for (const pp of puppets.values()) {
    if (!pp.e.isValid || !pp.at || !watched(pp, t)) continue;
    safe(() => hold(pp, t, true));
    unhide(pp, true);
  }
}
/** Whatever made it invisible: undone. @param {Puppet} pp @param {boolean} [late] */
function unhide(pp, late = false) {
  if (!safe(() => pp.e.getEffect("invisibility"), undefined)) return;
  safe(() => pp.e.removeEffect("invisibility"));
  emit("puppet", { what: "unhidden", id: pp.id, type: pp.type, late: true, end: late });
  if (system.currentTick - pp.foughtAt > 40) {
    pp.foughtAt = system.currentTick;
    note(pp.type, "fights");
  }
}

/** Every tick. */
export function tick() {
  if (!puppets.size) return;
  if (!S().enabled || S().puppets === false) return releaseAll("home");
  const t = system.currentTick;
  let late = false;
  for (const pp of [...puppets.values()]) {
    if (!pp.e.isValid) {
      // only carried off somewhere (another dimension): the same creature, found again — and pulled back by its hold
      const again = safe(() => world.getEntity(pp.id), undefined);
      if (again?.isValid) {
        pp.e = again;
        returning.delete(pp.id);
        continue;
      }
      // taken from it — by whatever made it, or by its death: it brings it back (unless the world just let go of the
      // place, nobody being near: then it is given back as it loads, as after a restart)
      const sn = returning.get(pp.id);
      if (sn && someoneNear(sn) && mayBringBack(sn)) {
        bringBack(pp, sn, t);
        continue;
      }
      puppets.delete(pp.id);
      returning.delete(pp.id);
      emit("puppet", { what: "release", how: "lost", why: pp.why, type: pp.type, id: pp.id });
      safe(() => pp.onRelease?.(pp, "lost"));
      continue;
    }
    if (t >= pp.until) {
      release(pp.id, pp.home ? "home" : "quiet");
      continue;
    }
    safe(() => step(pp, t));
    late = late || watched(pp, t);
  }
  if (late) safe(() => system.sendScriptEvent(LATE, ""));
}

/** Not on Peaceful (the game itself takes the hostile ones away), and not while the tests are clearing up. @param {Snap} sn */
function mayBringBack(sn) {
  if (DEBUG.bringBack === "off") return false;
  const peaceful = String(safe(() => String(world.getDifficulty()), "") ?? "").toLowerCase() === "peaceful";
  return !peaceful;
}
/** @param {Snap} sn */
function someoneNear(sn) {
  return world.getAllPlayers().some((p) => p.dimension.id === sn.dimId && V.dist(p.location, sn.loc) < 56);
}

/** @param {Puppet} pp @param {number} t */
function step(pp, t) {
  const e = pp.e;
  // its hold: moved by anything else, pulled straight back; pushed off where it stands, put back
  hold(pp, t);
  const p = pp.p?.isValid && pp.p.dimension.id === e.dimension.id ? pp.p : undefined;
  // its legs, its strength, its harmlessness: renewed often (every other tick for a kind that fights it)
  if (t % (pp.strict ? 2 : 4) === 0) refresh(pp);
  if (t % 10 === 0 && safe(() => e.getComponent("minecraft:onfire"), undefined)) safe(() => e.extinguishFire(false));
  // it cannot be hidden from you (whatever made it invisible slipped past the moment it was put on)
  unhide(pp);
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
      still(pp);
      const look = pp.face ?? eye;
      if (look) turn(pp, V.yawTo(e.location, look), look);
      break;
    }
    case "free":
      break;
    case "walk": {
      const to = pp.to;
      if (!to) {
        setMode(pp, pp.after ?? "stand");
        break;
      }
      // in twitches, like it: a burst, a stop — round whatever is in the way
      const d = chase.drive(pp, to, t, { speed: t % 12 < 8 ? 0.13 : 0.02, stopAt: 1.3, turn: 16, climb: true });
      if (d <= 1.3) {
        emit("puppet", { what: "arrived", why: pp.why, id: pp.id, d: Math.round(d * 10) / 10 });
        setMode(pp, pp.after ?? "stand");
      }
      break;
    }
    case "lurk":
    case "follow": {
      if (!p || !eye) {
        still(pp);
        break;
      }
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
        walk(pp, V.yawTo({ x: 0, y: 0, z: 0 }, dir), dir, 0.12);
      } else {
        pp.moving = false;
        still(pp);
      }
      break;
    }
    case "hunt": {
      // turned loose: stronger than it is, faster than you can run, and it cannot turn back — it is driven at you
      if (!p) {
        still(pp);
        break;
      }
      let goal = p.location, atThem = true;
      if (pp.role && pp.role !== "driver") {
        const driver = all().find((o) => o.pack === pp.pack && o.role === "driver" && o.id !== pp.id);
        const g = chase.packGoal(pp, p, driver?.e.location, t);
        goal = g.goal;
        atThem = g.atThem;
        if (g.wait) {
          // in the doorway ahead of them, waiting
          still(pp);
          turn(pp, V.yawTo(e.location, p.location), eye);
          break;
        }
      }
      chase.hunt(pp, p, goal, t, atThem);
      break;
    }
    case "mirror":
      if (p) mirror(pp, p, t);
      else still(pp);
      break;
    case "lead":
      if (p) lead(pp, p, t);
      else still(pp);
      break;
  }
  // where it left it this tick
  pp.at = { ...e.location };
  pp.atDim = e.dimension.id;
  pp.dimId = pp.atDim;
}

/**
 * Its hold: moved further than any step it takes (teleported away, to someone, into another dimension) — pulled
 * straight back; pushed off where it stands — put back. @param {Puppet} pp @param {number} t
 */
function hold(pp, t, late = false) {
  const e = pp.e;
  if (!pp.at || !pp.atDim) return;
  const cur = e.location;
  const dimId = e.dimension.id;
  const jumped = dimId !== pp.atDim || V.hdist(cur, pp.at) > (pp.strict ? JUMP_STRICT : JUMP) || cur.y - pp.at.y > 2.5 || pp.at.y - cur.y > 5;
  if (jumped) {
    const back = pp.at;
    const from = { ...cur };
    const ok = safe(() => {
      e.teleport(back, { dimension: world.getDimension(pp.atDim ?? dimId), rotation: { x: 0, y: pp.yaw }, keepVelocity: false });
      return true;
    }, false);
    if (!ok) return;
    if (dimId === pp.atDim) safe(() => e.dimension.spawnParticle(PARTICLES.puppetShred, from));
    if (t - pp.crackAt > 20) {
      pp.crackAt = t;
      safe(() => e.dimension.playSound(SOUNDS.crack, back, { volume: 0.6, pitch: 0.95 }));
    }
    if (pp.nav) pp.nav.plannedAt = -1e9;
    if (t - pp.foughtAt > 40) {
      pp.foughtAt = t;
      note(pp.type, "fights");
    }
    emit("puppet", { what: "yanked", id: pp.id, type: pp.type, d: Math.round(V.dist(from, back) * 10) / 10, dim: dimId !== pp.atDim, late });
    return;
  }
  if (pp.mode === "stand" && pp.anchor && (V.hdist(cur, pp.anchor) > (pp.strict ? DRIFT_STRICT : DRIFT) || Math.abs(cur.y - pp.anchor.y) > 1.6)) {
    const a = pp.anchor;
    safe(() => e.teleport(a, { rotation: { x: 0, y: pp.yaw }, keepVelocity: false }));
    emit("puppet", { what: "kept_still", id: pp.id, d: Math.round(V.hdist(cur, a) * 10) / 10 });
  }
}

/** Its legs off, its strength, its harmlessness, for what it is doing now. @param {Puppet} pp */
function refresh(pp) {
  if (!pp.e.isValid) return;
  if (pp.mode === "free") {
    give(pp, "weakness", 4);
    defuse(pp);
    return;
  }
  // the creature's own movement is off: it moves it
  give(pp, "slowness", 7);
  if (pp.mode === "hunt") {
    give(pp, "strength", 1);
    give(pp, "resistance", 0);
    give(pp, "fire_resistance", 0);
  } else {
    give(pp, "weakness", 4);
    defuse(pp);
  }
}

/** Held still: whatever speed it has is taken off it. @param {Puppet} pp */
function still(pp) {
  pp.moving = false;
  const v = safe(() => pp.e.getVelocity(), undefined);
  if (v && (v.x || v.z)) safe(() => pp.e.applyImpulse({ x: -v.x, y: 0, z: -v.z }));
}
/** @param {Puppet} pp */
function defuse(pp) {
  if (/creeper/.test(pp.type)) safe(() => pp.e.triggerEvent("minecraft:stop_exploding"));
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
  chase.face(pp, want, look, 16);
}

// ---------------------------------------------------------------- the mirror, the guide (1.4.0)

/**
 * The mirror: it moves as your reflection would, from where it is — you step sideways and it steps the same way, you
 * walk toward it and it walks toward you, you stop and it stops, you jump and it jumps; it faces you as your reflection
 * would (look at it and it looks back at you). At your pace, but no faster than a walk. @param {Puppet} pp @param {Player} p
 * @param {number} t
 */
function mirror(pp, p, t) {
  const e = pp.e;
  const loc = e.location;
  const pv = safe(() => p.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  // the plane between them: what comes toward it, it sends back toward them; what goes sideways, it keeps
  const n = V.flat(V.sub(loc, p.location));
  const along = pv.x * n.x + pv.z * n.z;
  let want = { x: pv.x - 2 * along * n.x, y: 0, z: pv.z - 2 * along * n.z };
  if (safe(() => p.isSneaking, false)) want = V.scale(want, 0.5);
  const sp = Math.hypot(want.x, want.z);
  if (sp > 0.22) want = V.scale(want, 0.22 / sp);
  const v = safe(() => e.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  let vy = 0;
  if ((safe(() => p.isJumping, false) || pv.y > 0.25) && t - pp.jumpAt > 8 && safe(() => e.isOnGround, true)) {
    vy = 0.42 - v.y;
    pp.jumpAt = t;
    emit("puppet", { what: "mirror_jump", id: pp.id });
  }
  safe(() => e.applyImpulse({ x: want.x - v.x, y: vy, z: want.z - v.z }));
  pp.moving = Math.hypot(want.x, want.z) > 0.03;
  const head = safe(() => e.getHeadLocation(), loc) ?? loc;
  pp.looked = viewAngle(p, head) < 12;
  // it faces as their reflection faces: their view, turned back across the same plane
  const f = V.fromYaw(safe(() => p.getRotation().y, 0) ?? 0);
  const fa = f.x * n.x + f.z * n.z;
  const rf = { x: f.x - 2 * fa * n.x, y: 0, z: f.z - 2 * fa * n.z };
  chase.face(pp, V.yawTo({ x: 0, y: 0, z: 0 }, rf), pp.looked ? p.getHeadLocation() : undefined, 30);
}

/**
 * The guide: it walks on ahead toward where it is leading, and when they fall behind it stops and looks back at them
 * until they come; there, it stands aside and waits. @param {Puppet} pp @param {Player} p @param {number} t
 */
function lead(pp, p, t) {
  const e = pp.e;
  const to = pp.to;
  if (!to) return still(pp);
  const eye = p.getHeadLocation();
  if (pp.arrived || V.hdist(e.location, to) < 1.6) {
    if (!pp.arrived) emit("puppet", { what: "led_there", id: pp.id });
    pp.arrived = true;
    still(pp);
    turn(pp, V.yawTo(e.location, eye), eye);
    return;
  }
  const d = V.hdist(e.location, p.location);
  if (d > 12 || (pp.waiting && d > 7)) {
    if (!pp.waiting) emit("puppet", { what: "looks_back", id: pp.id, d: Math.round(d) });
    pp.waiting = true;
    still(pp);
    turn(pp, V.yawTo(e.location, eye), eye);
    return;
  }
  pp.waiting = false;
  chase.drive(pp, to, t, { speed: d < 6 ? 0.16 : 0.12, stopAt: 1.4, turn: 18, climb: false, look: { x: to.x, y: to.y + 1.6, z: to.z } });
}

// ---------------------------------------------------------------- its voice, its senses

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
 * @param {number} r @param {boolean} [hidden] also those hidden among their kind (the charm of cold eyes hears them all)
 * @returns {Puppet|undefined}
 */
export function nearest(dimId, loc, r, hidden = false) {
  let best, bd = r;
  for (const pp of hidden ? all().filter((x) => x.dimId === dimId) : presences(dimId)) {
    const d = V.dist(pp.e.location, loc);
    if (d < bd) {
      best = pp;
      bd = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- nothing takes one from it

/** What it needs to bring one back. @param {Entity} e @param {Puppet} pp @param {string} why @returns {Snap} */
function snap(e, pp, why) {
  const loc = safe(() => ({ ...e.location }), undefined) ?? pp.at ?? pp.origin;
  return {
    type: pp.type,
    loc: pp.at && V.dist(pp.at, loc) < 3 ? { ...pp.at } : loc,
    dimId: pp.atDim ?? pp.dimId,
    yaw: pp.yaw,
    hp: safe(() => e.getComponent("minecraft:health")?.currentValue, 0) ?? 0,
    name: safe(() => e.nameTag, "") ?? "",
    why,
  };
}

/**
 * Bring back one taken from it: the same kind, where it was, its eyes already in it, doing what it was doing.
 * @param {Puppet} pp @param {Snap} sn @param {number} t
 */
function bringBack(pp, sn, t) {
  pp.backs = pp.backs.filter((b) => t - b < 200);
  // taken again and again: it bides its time a moment between (it never gives up)
  if (pp.backs.length >= 5 && t - pp.backs[pp.backs.length - 1] < 60) return;
  const dim = world.getDimension(sn.dimId);
  /** @type {Entity|undefined} */
  let ne;
  try {
    ne = dim.spawnEntity(sn.type, sn.loc, { initialRotation: sn.yaw });
  } catch (err) {
    // somewhere not loaded this tick: again next tick; a kind nothing can bring into the world: let go
    if (/summon|spawn|identifier|not found/i.test(String(err))) {
      returning.delete(pp.id);
      puppets.delete(pp.id);
      emit("puppet", { what: "release", how: "lost", why: pp.why, type: pp.type, id: pp.id, err: String(err) });
      safe(() => pp.onRelease?.(pp, "lost"));
    }
    return;
  }
  if (!ne) return;
  const old = pp.id;
  puppets.delete(old);
  returning.delete(old);
  aliases.set(old, pp);
  pp.e = ne;
  pp.id = ne.id;
  pp.revive = false;
  pp.fx.clear();
  pp.nav = undefined;
  pp.at = { ...sn.loc };
  pp.atDim = sn.dimId;
  pp.dimId = sn.dimId;
  if (pp.mode === "stand") pp.anchor = { ...sn.loc };
  pp.backs.push(t);
  puppets.set(ne.id, pp);
  safe(() => ne.setDynamicProperty(PROP, JSON.stringify({ why: pp.why, at: [Math.round(pp.origin.x * 10) / 10, Math.round(pp.origin.y * 10) / 10, Math.round(pp.origin.z * 10) / 10], d: pp.dimId })));
  if (sn.name) safe(() => (ne.nameTag = sn.name));
  const hc = safe(() => ne.getComponent("minecraft:health"), undefined);
  if (hc && sn.hp > 0) safe(() => hc.setCurrentValue(Math.min(sn.hp, hc.effectiveMax)));
  refresh(pp);
  eyes(ne);
  safe(() => dim.spawnParticle(PARTICLES.puppetBurst, sn.loc));
  safe(() => dim.playSound(SOUNDS.crack, sn.loc, { volume: 1, pitch: 0.8 }));
  // what it learns: whatever made it takes it back — up on the surface, or down below
  const top = safe(() => dim.getTopmostBlock({ x: sn.loc.x, z: sn.loc.z }), undefined);
  note(pp.type, "removed");
  note(pp.type, top && top.location.y > sn.loc.y + 4 ? "removedDown" : "removedUp");
  note(pp.type, "back");
  emit("puppet", { what: "brought_back", old, id: ne.id, type: pp.type, why: sn.why, x: sn.loc.x, y: sn.loc.y, z: sn.loc.z });
  if (pp.p?.isValid && V.dist(pp.p.location, sn.loc) < 32) discover(pp.p, "it_brings_them_back");
}

/** Killed by you: it stays dead — and leaves a cold eye. @param {Puppet} pp @param {Player} p @param {Entity} e */
function killed(pp, p, e) {
  puppets.delete(pp.id);
  returning.delete(pp.id);
  const l = safe(() => ({ ...e.location }), undefined) ?? pp.at ?? pp.origin;
  const dim = safe(() => e.dimension, undefined) ?? world.getDimension(pp.dimId);
  safe(() => dim.spawnItem(new ItemStack(ITEMS.coldEye, 1), { x: l.x, y: l.y + 0.6, z: l.z }));
  safe(() => dim.spawnParticle(PARTICLES.puppetBurst, l));
  const s = ps(p);
  s.puppets = s.puppets ?? { taken: 0, seen: 0, torn: 0 };
  s.puppets.killed = (s.puppets.killed ?? 0) + 1;
  markPlayerDirty(p);
  discover(p, "cold_eyes");
  emit("puppet", { what: "release", how: "killed", why: pp.why, type: pp.type, id: pp.id, player: p.name });
  safe(() => pp.onRelease?.(pp, "killed"));
}

/** @param {any} by @returns {Player|undefined} */
const playerOf = (by) => (by && safe(() => by.typeId, "") === "minecraft:player" ? by : undefined);

/** Hooks main.js fills in: one of its puppets' own blows landed on someone (the hunt strikes through it less). */
export function landed(/** @type {Entity} */ by) {
  const pp = get(safe(() => by.id, "") ?? "");
  if (pp) chase.landed(pp, system.currentTick);
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
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id === LATE) lateLook();
  }, { namespaces: ["observer_hold"] });
  // held means harmless — and nothing but you harms one of its own (decided before the harm lands)
  world.beforeEvents.entityHurt.subscribe((ev) => {
    const hurt = ev.hurtEntity;
    const hid = safe(() => hurt.id, "") ?? "";
    const src = ev.damageSource;
    const by = src.damagingEntity;
    const byType = by ? safe(() => by.typeId, "") ?? "" : "";
    const mine = puppets.size ? puppets.get(hid) : undefined;
    if (mine) {
      if (byType === "minecraft:player" || byType.startsWith("observer:") || src.cause === "void" || src.cause === "selfDestruct") return;
      ev.cancel = true;
      return;
    }
    if (safe(() => hurt.typeId, "") !== "minecraft:player") return;
    if (by) {
      const bid = safe(() => by.id, "") ?? "";
      // the creatures it holds for its own ends (its watchers, those it sends away) are as harmless as its puppets
      if (isHeld(bid)) {
        ev.cancel = true;
        return;
      }
      const pp = puppets.get(bid);
      if (pp && pp.mode !== "hunt") {
        ev.cancel = true;
        const type = pp.type;
        system.run(() => {
          note(type, "blocked");
          emit("puppet", { what: "blocked", type, id: pp.id, cause: src.cause });
        });
      }
      return;
    }
    // harm from nowhere (whatever made it, in its own name) right beside one it holds
    if (!puppets.size || !NAMELESS.has(src.cause)) return;
    const at = safe(() => hurt.location, undefined);
    const dimId = safe(() => hurt.dimension.id, "");
    if (!at) return;
    let held, hunting = false;
    for (const pp of puppets.values()) {
      if (pp.dimId !== dimId || !pp.at || V.dist(pp.at, at) > 4.5) continue;
      if (pp.mode === "hunt") hunting = true;
      else held = pp;
    }
    if (held && !hunting) {
      ev.cancel = true;
      const type = held.type, id = held.id;
      system.run(() => {
        note(type, "blocked");
        emit("puppet", { what: "blocked", type, id, cause: src.cause, nameless: true });
      });
    }
  });
  // it cannot be hidden from you
  world.beforeEvents.effectAdd.subscribe((ev) => {
    if (DEBUG.trace && puppets.size && puppets.has(safe(() => ev.entity.id, "") ?? "")) {
      const type = ev.effectType;
      system.run(() => emit("puppet", { what: "effect_add_seen", type }));
    }
    if (!puppets.size || !/invisib/i.test(ev.effectType)) return;
    const pp = puppets.get(safe(() => ev.entity.id, "") ?? "");
    if (!pp) return;
    ev.cancel = true;
    system.run(() => {
      emit("puppet", { what: "unhidden", id: pp.id, type: pp.type });
      if (system.currentTick - pp.foughtAt > 40) {
        pp.foughtAt = system.currentTick;
        note(pp.type, "fights");
      }
    });
  });
  // taken from it: noted now, brought back on its next tick (unless the world is only letting go of the place)
  world.beforeEvents.entityRemove.subscribe((ev) => {
    if (!puppets.size) return;
    const e = ev.removedEntity;
    const pp = puppets.get(safe(() => e.id, "") ?? "");
    if (!pp || pp.revive) return;
    returning.set(pp.id, snap(e, pp, "removed"));
  });
  // its puppets' deaths: killed by you, it stays dead (and leaves a cold eye); anything else, it brings it back
  world.afterEvents.entityDie.subscribe((ev) => {
    if (!puppets.size) return;
    const e = ev.deadEntity;
    const pp = puppets.get(safe(() => e.id, "") ?? "");
    if (!pp) return;
    const p = playerOf(ev.damageSource.damagingEntity);
    if (p) return killed(pp, p, e);
    returning.set(pp.id, snap(e, pp, "died"));
    pp.revive = true;
    safe(() => e.remove());
  });
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
  aliases.clear();
  returning.clear();
  return n;
}

/** For the dev command and the Config Wheel. */
export function status() {
  return all().map((pp) => `${pp.e.typeId}:${pp.why}/${pp.mode}${pp.role ? `/${pp.role}` : ""}${pp.strict ? "!" : ""}`).join(" ") || "none";
}

/** May it turn its puppets on someone (the hunt)? @param {Player} p */
export const mayHunt = (p) => aggression() >= 2 && ps(p).stage >= 4;

/** Tests and the rage: how many of its own it holds in a pack hunting someone. @param {string} pack */
export const packOf = (pack) => all().filter((pp) => pp.pack === pack);
