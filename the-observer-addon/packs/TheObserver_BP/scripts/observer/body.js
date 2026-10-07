// @ts-check
// The single physical Observer. Encounters borrow it; only one exists in the world at a time.
//
// Modes (behaviour-pack component groups):
//   still    no gravity, no movement: observation poses (can stand on water / ledges)
//   approach slow pursuit of the tagged target (~1.5 b/s)
//   pursue   chase the tagged target (~4.8 b/s: faster than walking, slower than sprinting)
//   retreat  walk away from players
// States (client animation, entity property observer:state):
//   watch stare tilt walk run attack peek recoil hidden
import { world, system, EntityDamageCause } from "@minecraft/server";
import { OBSERVER_ID, TARGET_TAG, ENTITY_ENC_PROP, PARTICLES, SOUNDS, DANGER } from "../core/constants.js";
import { V, safe, DEBUG, trace, emit, allPlayers } from "../core/util.js";
import { S, strikeDamage } from "../core/settings.js";
import { visibility, lineOfSight, seenByAny } from "../world/sight.js";
import { standNear, isReplaceable } from "../world/space.js";

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
 * @property {number} spawnedTick
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
 * @param {{enc:number, target?:Player, state?:string, stoop?:boolean, side?:number, face?:Vec}} o
 * @returns {Body|null}
 */
export function spawn(dim, loc, o) {
  despawn("replace");
  const e = safe(() => dim.spawnEntity(OBSERVER_ID, loc, { initialPersistence: false }));
  if (!e) return null;
  safe(() => e.setDynamicProperty(ENTITY_ENC_PROP, o.enc));
  body = { e, enc: o.enc, state: "watch", mode: "still", stoop: false, side: 1, target: o.target, faceTarget: true, spawnedTick: system.currentTick };
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

/** @param {"still"|"approach"|"pursue"|"retreat"} m */
export function setMode(m) {
  const b = get();
  if (!b || b.mode === m) return;
  b.mode = m;
  if (b.target && (m === "approach" || m === "pursue")) {
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
    if (why === "unravel") safe(() => e.dimension.spawnParticle(PARTICLES.unravel, { x: l.x, y: l.y + 1.6, z: l.z }));
    safe(() => e.remove());
  }
  for (const p of world.getPlayers({ tags: [TARGET_TAG] })) safe(() => p.removeTag(TARGET_TAG));
  trace(`body removed (${why})`);
  emit("body", { what: "remove", why });
  body = null;
}

const TURNS = [0, 30, -30, 60, -60, 100, -100, 140, -140];

/**
 * One walking step of at most 1 block up or down, with 3 open blocks above the feet.
 * @param {import("@minecraft/server").Dimension} dim @param {Vec} pos @param {Vec} dir @param {number} len
 */
function step(dim, pos, dir, len) {
  for (const a of TURNS) {
    const r = (a * Math.PI) / 180;
    const d = { x: dir.x * Math.cos(r) - dir.z * Math.sin(r), y: 0, z: dir.x * Math.sin(r) + dir.z * Math.cos(r) };
    const nx = pos.x + d.x * len, nz = pos.z + d.z * len;
    const ground = safe(() => dim.getBlockBelow({ x: nx, y: pos.y + 1.2, z: nz }, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: 3.5 }));
    if (!ground || DANGER.has(ground.typeId)) continue;
    const fy = ground.location.y + 1;
    if (Math.abs(fy - pos.y) > 1.05) continue;
    let open = true;
    for (let h = 0; h < 3 && open; h++) open = isReplaceable(safe(() => dim.getBlock({ x: nx, y: fy + h, z: nz })));
    if (open) return { loc: { x: nx, y: fy, z: nz }, dir: d };
  }
  return undefined;
}

/**
 * Leave the scene: walk away from the watchers (script-driven steps; the retreat AI goal proved
 * unreliable in testing) and remove the body once no player sees it, or after maxTicks (then it
 * "unravels" in place, a rare visible exit).
 * @param {Player[]} watchers @param {number} maxTicks
 */
export async function withdraw(watchers, maxTicks = 160) {
  const b = get();
  if (!b) return;
  const dim = b.e.dimension;
  setMode("still");
  b.faceTarget = false;
  setState("walk");
  safe(() => dim.playSound(SOUNDS.fabric, b.e.location, { volume: 0.5 }));
  let pos = b.e.location;
  const near = watchers.filter((p) => p.isValid && p.dimension.id === dim.id);
  let dir = near.length
    ? V.flat(V.sub(pos, near.reduce((a, p) => V.add(a, V.scale(p.location, 1 / near.length)), { x: 0, y: 0, z: 0 })))
    : V.fromYaw((safe(() => b.e.getRotation().y, 0) ?? 0) + 180);
  for (let t = 0; t < maxTicks; t += 2) {
    await system.waitTicks(2);
    // stop if the body was removed or replaced by another encounter's body meanwhile
    if (get() !== b) return;
    const st = step(dim, pos, dir, 0.18);
    if (st) {
      pos = st.loc;
      dir = st.dir;
      safe(() => b.e.teleport(pos, { facingLocation: { x: pos.x + dir.x * 4, y: pos.y + 3, z: pos.z + dir.z * 4 } }));
    } else setState("watch"); // cornered: it waits to be unobserved
    if (t >= 16 && t % 4 === 0 && !visibleTo(watchers)) {
      despawn("withdrew");
      return;
    }
  }
  despawn("unravel");
}

/**
 * Telegraphed strike, synced to the supplied attack clip (strike frame ~0.55-0.65 s).
 * Avoidable: the target can step out of reach during the 0.6 s wind-up.
 * @param {Player} target
 * @returns {Promise<"hit"|"miss"|"none">}
 */
export async function strike(target) {
  const b = get();
  if (!b) return "none";
  setMode("still");
  faceTo(target.getHeadLocation());
  setState("attack");
  await system.waitTicks(12);
  if (!get() || !target.isValid) return "none";
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
    // never one-shot a healthy player: a strike cannot take more than 70% of current health above half health
    if (hp && hp.currentValue > hp.effectiveMax * 0.5) amount = Math.min(amount, Math.max(1, Math.floor(hp.currentValue * 0.7)));
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
  await system.waitTicks(13);
  if (get()) setState("stare");
  return /** @type {any} */ (result);
}

// ---------------------------------------------------------------- per-tick maintenance

/**
 * Called every 5 ticks: keep facing the target while still, stoop under low ceilings,
 * and show eye glints to nearby players when it stands in darkness.
 */
export function maintain(tick) {
  const b = get();
  if (!b) return;
  const e = b.e;
  const l = e.location;
  if (b.mode === "still" && b.faceTarget && b.target?.isValid && b.target.dimension.id === e.dimension.id) faceTo(b.target.getHeadLocation());
  // headroom: stoop when fewer than 5 open blocks above
  const ceil = safe(() => e.dimension.getBlockAbove({ x: l.x, y: l.y + 0.1, z: l.z }, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: 5 }));
  setStoop(!!ceil && ceil.location.y - Math.floor(l.y) < 5);
  if (tick % 10 === 0 && b.state !== "hidden") {
    const head = { x: l.x, y: l.y + (b.stoop ? 2.45 : 3.62), z: l.z };
    const light = safe(() => e.dimension.getLightLevel(head), 15) ?? 15;
    if (light <= 6) {
      const yaw = e.getRotation().y;
      const fwd = V.fromYaw(yaw);
      const side = { x: -fwd.z, y: 0, z: fwd.x };
      for (const p of e.dimension.getPlayers({ location: l, maxDistance: 56 })) {
        // only toward players in front of it: the glint is its eyes catching the light
        if (V.dot(fwd, V.flat(V.sub(p.location, l))) < 0.2) continue;
        for (const s of [-1, 1]) {
          const eye = V.add(V.add(head, V.scale(fwd, 0.27)), V.scale(side, 0.13 * s));
          safe(() => p.spawnParticle(PARTICLES.glint, eye));
        }
      }
    }
  }
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
