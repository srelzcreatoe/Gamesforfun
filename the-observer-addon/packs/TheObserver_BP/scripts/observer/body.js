// @ts-check
// The single physical Observer. Encounters borrow it; only one exists in the world at a time.
//
// Modes (behaviour-pack component groups):
//   still    no gravity, no movement: observation poses (can stand on water / ledges)
//   approach slow pursuit of the tagged target (~1.5 b/s)
//   pursue   chase the tagged target (~4.8 b/s: faster than walking, slower than sprinting)
//   retreat  walk away from players
//   rage     provoked: it rushes the tagged target (~8 b/s, faster than a sprint)
// States (client animation, entity property observer:state):
//   watch stare tilt walk run attack peek recoil hidden float surge climb hang crawl   ("run" is unused since
//   1.0.8: every run, chase and attack floats)
// It never walks off: when it is done it is simply gone, torn apart where it stood (vanish()).
import { world, system, EntityDamageCause } from "@minecraft/server";
import { OBSERVER_ID, TARGET_TAG, ENTITY_ENC_PROP, PARTICLES, SOUNDS } from "../core/constants.js";
import { V, safe, DEBUG, trace, emit, allPlayers } from "../core/util.js";
import { S, strikeDamage, aggression } from "../core/settings.js";
import { visibility, lineOfSight, seenByAny } from "../world/sight.js";
import { standNear, coverSide } from "../world/space.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */

/**
 * @typedef {Object} Body
 * @property {Entity} e
 * @property {number} enc
 * @property {string} state
 * @property {string} mode
 * @property {boolean} stoop
 * @property {number} side
 * @property {Player|undefined} target
 * @property {boolean} faceTarget
 * @property {boolean} dark        eyes glowing (observer:dark)
 * @property {boolean} autoPeek    switch between watch and peek by the cover beside it
 * @property {number} spawnedTick
 * @property {boolean} [repelled]  driven off (a flare): a strike already winding up does nothing
 * @property {boolean} [clinging]  on a wall, climbing after a player above it (observer/climb.js)
 * @property {boolean} [hung]      reached the top of its climb and hangs there beside them
 * @property {boolean} [silent]    floating: no footstep sounds
 * @property {boolean} [crawling]  flat on its front with a collision box a block high (observer/squeeze.js)
 */

/** @type {Body|null} */
let body = null;
/** encounter whose body vanished without despawn() (killed by command, unloaded, ...) */
let lostEnc = -1;

/** @returns {Body|null} */
export function get() {
  if (body && !body.e.isValid) {
    lostEnc = body.enc;
    body = null;
  }
  return body;
}
export const exists = () => !!get();
/** Did this encounter's body disappear unexpectedly? @param {number} enc */
export const wasLost = (enc) => lostEnc === enc;

/**
 * Spawn the Observer for an encounter.
 * @param {import("@minecraft/server").Dimension} dim @param {Vec} loc
 * @param {{enc:number, target?:Player, state?:string, stoop?:boolean, side?:number, face?:Vec, silent?:boolean, autoPeek?:boolean}} o
 * @returns {Body|null}
 */
export function spawn(dim, loc, o) {
  despawn("replace");
  // it only ever peeks from behind something: with nothing beside it, it stands
  if (o.state === "peek") {
    const eye = o.target?.isValid ? o.target.getHeadLocation() : o.face;
    const cover = eye ? coverSide(dim, loc, eye) : undefined;
    if (!cover || !cover.one) o = { ...o, state: "watch" };
    else o = { ...o, side: cover.side };
  }
  const e = safe(() => dim.spawnEntity(OBSERVER_ID, loc, { initialPersistence: false }));
  if (!e) return null;
  safe(() => e.setDynamicProperty(ENTITY_ENC_PROP, o.enc));
  body = { e, enc: o.enc, state: "watch", mode: "still", stoop: false, side: 1, target: o.target, faceTarget: true, spawnedTick: system.currentTick,
    dark: false, autoPeek: o.autoPeek ?? true };
  // pressure in the ears: it has arrived (quieter when it arrives unseen behind someone)
  if (!o.silent) safe(() => dim.playSound(SOUNDS.presence, loc, { volume: 0.75 }));
  setState(o.state ?? "watch");
  setStoop(!!o.stoop);
  if (o.side) setSide(o.side);
  const face = o.face ?? o.target?.getHeadLocation();
  if (face) faceTo(face);
  trace(`body spawned enc=${o.enc} at ${V.str(loc)} state=${o.state ?? "watch"}`);
  emit("body", { what: "spawn", enc: o.enc, x: loc.x, y: loc.y, z: loc.z, state: o.state ?? "watch", stoop: !!o.stoop });
  return body;
}

/** @param {string} s */
export function setState(s) {
  const b = get();
  if (!b || b.state === s) return;
  b.state = s;
  safe(() => b.e.setProperty("observer:state", s));
}
/** @param {boolean} v */
export function setStoop(v) {
  const b = get();
  if (!b || b.stoop === v) return;
  b.stoop = v;
  safe(() => b.e.setProperty("observer:stoop", v));
}
/** @param {number} side -1 | 1 */
export function setSide(side) {
  const b = get();
  if (!b || b.side === side) return;
  b.side = side;
  safe(() => b.e.setProperty("observer:side", side));
}

/**
 * Floating or climbing: no footsteps (the step sound needs a huge distance between steps), and afloat on
 * the client, so a strike, a recoil or a stare in between stays in mid-air with its legs hanging.
 * @param {boolean} v
 */
export function setSilent(v) {
  const b = get();
  if (!b || !!b.silent === v) return;
  b.silent = v;
  safe(() => b.e.triggerEvent(v ? "observer:steps_off" : "observer:steps_on"));
  safe(() => b.e.setProperty("observer:afloat", v));
}

/** Flat on its front, a block high, to get through a low gap (or back up again). @param {boolean} v */
export function setCrawl(v) {
  const b = get();
  if (!b || !!b.crawling === v) return;
  b.crawling = v;
  safe(() => b.e.triggerEvent(v ? "observer:crawl_on" : "observer:crawl_off"));
}

/** Rise and come at someone through the air: afloat, silent, the surge clip. */
export function surge() {
  setSilent(true);
  setState("surge");
}

/** @param {"still"|"approach"|"pursue"|"retreat"|"rage"} m */
export function setMode(m) {
  const b = get();
  if (!b || b.mode === m) return;
  if (m !== "still") b.clinging = b.hung = false;
  b.mode = m;
  if (b.target && (m === "approach" || m === "pursue" || m === "rage")) {
    for (const p of world.getPlayers({ tags: [TARGET_TAG] })) if (p.id !== b.target.id) p.removeTag(TARGET_TAG);
    safe(() => b.target?.addTag(TARGET_TAG));
  }
  safe(() => b.e.triggerEvent(`observer:to_${m}`));
  if (m === "still") safe(() => b.e.clearVelocity());
}

/** @param {Vec} point */
export function faceTo(point) {
  const b = get();
  if (!b) return;
  const head = { x: b.e.location.x, y: b.e.location.y + (b.stoop ? 2.5 : 3.6), z: b.e.location.z };
  safe(() => b.e.setRotation({ x: V.pitchTo(head, point), y: V.yawTo(b.e.location, point) }));
}

/** Relocate instantly (only used while unseen, or as a deliberate effect). */
export function moveTo(loc, face) {
  const b = get();
  if (!b) return false;
  const ok = safe(() => {
    b.e.teleport(loc, face ? { facingLocation: face } : undefined);
    return true;
  }, false);
  return !!ok;
}

export const loc = () => get()?.e.location;

/** Is the body currently being looked at by any of these players? */
export function watchedBy(players, fov = 26) {
  const b = get();
  if (!b) return false;
  return players.some((p) => p.isValid && p.dimension.id === b.e.dimension.id && visibility(p, b.e.location, { stooped: b.stoop, fov }).points > 0);
}

/** Visible at all (in frame) to any of these players. */
export function visibleTo(players) {
  const b = get();
  if (!b) return false;
  return seenByAny(players.filter((p) => p.isValid && p.dimension.id === b.e.dimension.id), b.e.location, b.stoop);
}

/** Remove the body. @param {string} why */
export function despawn(why = "") {
  if (!body) return;
  const e = body.e;
  if (e.isValid) {
    const l = e.location;
    // it tears apart into crimson shreds (supplied vanish sprites), unless it is only being replaced
    if (why !== "replace") {
      const seen = safe(() => seenByAny(allPlayers().filter((p) => p.dimension.id === e.dimension.id), l, body.stoop), false);
      safe(() => e.dimension.spawnParticle(PARTICLES.vanish, l));
      safe(() => e.dimension.playSound(SOUNDS.vanish, l, { volume: seen ? 0.9 : 0.45 }));
      emit("fx", { what: "vanish", why, seen: !!seen });
    }
    safe(() => e.remove());
  }
  for (const p of world.getPlayers({ tags: [TARGET_TAG] })) safe(() => p.removeTag(TARGET_TAG));
  trace(`body removed (${why})`);
  emit("body", { what: "remove", why });
  body = null;
}

/**
 * Leave the scene. It does not walk off: it holds where it is for a breath, then it is simply gone, torn apart
 * where it stood.
 */
export async function vanish() {
  const b = get();
  if (!b) return;
  setMode("still");
  await system.waitTicks(4);
  if (get() !== b) return;
  despawn("vanished");
}

/**
 * Telegraphed strike, synced to the supplied attack clip (strike frame ~0.55-0.65 s).
 * Avoidable: the target can step out of reach during the 0.6 s wind-up.
 * @param {Player} target @param {{recover?:number}} [opts] recover: ticks before it can act again
 * @returns {Promise<"hit"|"miss"|"none">}
 */
export async function strike(target, opts = {}) {
  const b = get();
  if (!b) return "none";
  setMode("still");
  faceTo(target.getHeadLocation());
  setState("attack");
  await system.waitTicks(12);
  if (!get() || !target.isValid || b.repelled) return "none";
  const o = b.e.location;
  const tl = target.location;
  const fwd = V.fromYaw(b.e.getRotation().y);
  const to = V.flat(V.sub(tl, o));
  const d = V.hdist(o, tl);
  // a running body can end up almost on top of the target: at that range direction is meaningless
  const inFront = d < 1.2 || V.dot(fwd, V.flat(to)) > 0.35;
  const reach = d <= 3.3 && Math.abs(tl.y - o.y) < 2.5;
  const clear = lineOfSight(b.e.dimension, { x: o.x, y: o.y + 2.2, z: o.z }, target.getHeadLocation()).clear;
  let result = "miss";
  const dmg = strikeDamage();
  if (inFront && reach && clear && dmg > 0) {
    const hp = target.getComponent("minecraft:health");
    let amount = dmg;
    // on Low aggression a strike never takes more than 70% of current health above half health;
    // on Standard and High it hits at full strength (and keeps attacking — see common.relentless)
    if (aggression() === 1 && hp && hp.currentValue > hp.effectiveMax * 0.5) amount = Math.min(amount, Math.max(1, Math.floor(hp.currentValue * 0.7)));
    safe(() => target.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: b.e }));
    safe(() => target.applyKnockback({ x: to.x * 0.9, z: to.z * 0.9 }, 0.35));
    safe(() => b.e.dimension.playSound(SOUNDS.strike, tl, { volume: 1 }));
    result = "hit";
  } else {
    safe(() => b.e.dimension.playSound(SOUNDS.whiff, o, { volume: 0.8 }));
    if (inFront && reach && clear && dmg === 0) result = "hit"; // Atmosphere preset: contact without damage
  }
  trace(`strike ${result}: front=${inFront} reach=${reach} d=${d.toFixed(2)} dy=${(tl.y - o.y).toFixed(2)} clear=${clear} dmg=${dmg}`);
  emit("strike", { result, inFront, reach, clear, d, dy: tl.y - o.y });
  await system.waitTicks(opts.recover ?? 13);
  if (get()) setState("stare");
  return /** @type {any} */ (result);
}

// ---------------------------------------------------------------- per-tick maintenance

/**
 * Called every 5 ticks: keep facing the target while still, stoop under low ceilings,
 * and show eye glints to nearby players when it stands in darkness.
 * @param {number} run  how many times the 5-tick loop has run
 */
export function maintain(run) {
  const b = get();
  if (!b) return;
  const e = b.e;
  const l = e.location;
  if (b.mode === "still" && b.faceTarget && b.target?.isValid && b.target.dimension.id === e.dimension.id) faceTo(b.target.getHeadLocation());
  // headroom: stoop when fewer than 5 open blocks above
  const ceil = safe(() => e.dimension.getBlockAbove({ x: l.x, y: l.y + 0.1, z: l.z }, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: 5 }));
  // (hanging upside down or crawling it has its own shape)
  setStoop(b.state !== "hang" && b.state !== "crawl" && !!ceil && ceil.location.y - Math.floor(l.y) < 5);
  if (run % 4 !== 0) return;
  // eyes glow (client layer + glow at the eye locators) at night or in darkness
  const head = { x: l.x, y: l.y + (b.stoop ? 2.45 : 3.62), z: l.z };
  const light = safe(() => e.dimension.getLightLevel(head), 15) ?? 15;
  const tod = safe(() => world.getTimeOfDay(), 6000) ?? 6000;
  const night = e.dimension.id === "minecraft:overworld" && tod > 12800 && tod < 23200;
  setDark(night || light <= 7);
  // it peeks out from behind whatever stands beside it (a trunk, a wall corner, a door frame)
  if (b.mode === "still" && b.autoPeek && (b.state === "watch" || b.state === "peek") && b.target?.isValid && b.target.dimension.id === e.dimension.id) {
    const cover = coverSide(e.dimension, l, b.target.getHeadLocation());
    if (cover.one) {
      setSide(cover.side);
      setState("peek");
    } else if (b.state === "peek") setState("watch");
  }
}

/** @param {boolean} v */
function setDark(v) {
  const b = get();
  if (!b || b.dark === v) return;
  b.dark = v;
  safe(() => b.e.setProperty("observer:dark", v));
}

/** Remove Observers that do not belong to the active encounter (left over after a crash or reload). */
export function isStray(e, activeEnc) {
  const enc = safe(() => e.getDynamicProperty(ENTITY_ENC_PROP));
  if (enc === undefined) return false; // spawn egg / summoned "puppet"
  const b = get();
  return !(b && b.e.id === e.id) && enc !== activeEnc;
}

export function registerEvents(getActiveEnc) {
  world.afterEvents.entityLoad.subscribe((ev) => {
    const e = ev.entity;
    if (e.typeId === OBSERVER_ID && isStray(e, getActiveEnc())) {
      DEBUG.log("removing stray Observer on load");
      safe(() => e.remove());
    }
  });
}

/** Sweep near players for strays (startup and every 30 s). */
export function sweepStrays(activeEnc) {
  for (const p of allPlayers()) {
    for (const e of safe(() => p.dimension.getEntities({ type: OBSERVER_ID, location: p.location, maxDistance: 160 }), []) ?? []) {
      if (isStray(e, activeEnc)) safe(() => e.remove());
    }
  }
}

/** Puppets (spawn eggs / summon) just stand and watch the nearest player. */
export function tickPuppets() {
  for (const p of allPlayers()) {
    for (const e of safe(() => p.dimension.getEntities({ type: OBSERVER_ID, location: p.location, maxDistance: 48 }), []) ?? []) {
      if (safe(() => e.getDynamicProperty(ENTITY_ENC_PROP)) !== undefined) continue;
      const head = p.getHeadLocation();
      safe(() => e.setRotation({ x: V.pitchTo({ x: e.location.x, y: e.location.y + 3.6, z: e.location.z }, head), y: V.yawTo(e.location, head) }));
    }
  }
}

/** Snap a location to valid ground nearby (used before moving the body). */
export function groundNear(dim, loc) {
  const st = standNear(dim, loc.x, loc.z, loc.y);
  return st?.loc;
}
