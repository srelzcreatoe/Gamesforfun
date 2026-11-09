// @ts-check
// The Shaftbreaker's brain. One physical creature, driven by a state machine:
//   dormant -> stalk -> standoff -> (scream) hunt -> search -> leave
// plus ambush, retreat (backing away into the dark), escort (watching you leave), escape (badly
// hurt) and vanish (phasing out). Movement is physical: vanilla pathfinding walks it to waypoints or
// chases its prey; teleports are only used while nobody can see it.
import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { cfg, harmless } from "../core/config.js";
import { W, markDirty } from "../core/state.js";
import {
  DWELLER_ID, WAYPOINT_ID, PREY_TAG, now, clamp, rand, randInt, chance, pick, weighted, dist, distXZ, sub, add, mul,
  norm, flat, dot, getBlock, guard, alive, yawOf, center,
} from "../core/util.js";
import { passable, solid, isWater } from "../core/blocks.js";
import { T } from "./threat.js";
import { getP, PS, eligible, inLowSpace } from "./players.js";
import { playerSees, creatureSees, clearLine, lookDot, eyeHeight, noises, playerLightBonus } from "./perception.js";
import { requestNav } from "./navmap.js";
import { abilities, aggressionFor, noteEscape, noteSpot, teach, habituation } from "./memory.js";
import { territoryAt } from "../world/territory.js";
import { organHealth, podHears } from "../world/organs.js";
import { stinger, caption, stopAllMusic } from "../fx/audio.js";
import { extinguishTorches, findDoor, setDoor, smashToward, scratchWalls, tauntDoor } from "../fx/environment.js";
import { unlock } from "../ui/journal.js";

export const brainHooks = {
  /** @type {null | ((b:any, reason:string) => void)} */ onEnd: null,
};

const DMG = { easy: 5, normal: 7, brutal: 10 };

// ============================================================================================ creation
let spawningSelf = false;
export const isSpawningSelf = () => spawningSelf;

/**
 * @param {import("@minecraft/server").Player} pl target
 * @param {{x:number,y:number,z:number}} loc
 * @param {{start?:string, final?:boolean, enraged?:boolean, tunnel?:boolean, materialize?:boolean}} opts
 */
export function spawnCreature(pl, loc, opts = {}) {
  if (T.brain && alive(T.brain.e)) return null;
  let e;
  spawningSelf = true;
  try {
    e = pl.dimension.spawnEntity(DWELLER_ID, loc);
  } catch {
    return null;
  } finally {
    spawningSelf = false;
  }
  guard("tier", () => e.triggerEvent("shaftbreaker:tier_" + cfg.tier));
  const b = createBrain(e, pl, opts);
  T.brain = b;
  if (opts.materialize) {
    setProp(b, "materialize", true);
    system.runTimeout(() => guard("mat", () => setProp(b, "materialize", false)), 40);
    guard("phaseIn", () => e.dimension.spawnParticle("shaftbreaker:phase_in", e.location));
    guard("appear", () => e.dimension.playSound("shaftbreaker.appear", e.location));
  }
  faceTo(b, pl.getHeadLocation());
  const start = opts.start || "stalk";
  if (start === "standoff") enterStandoff(b, pl);
  else if (start === "hunt") engage(b, pl, "ambush");
  else if (start === "scream") engage(b, pl, "scream");
  else if (start === "dormant") enterDormant(b);
  else if (start === "ambush") enterAmbush(b, pl, null);
  else enterStalk(b, pl);
  if (opts.tunnel) b.tunnelWatch = true;
  W.encounters++;
  markDirty();
  const p = getP(pl);
  p.profile.enc++;
  p.profDirty = true;
  return b;
}

/** Adopt an existing creature entity (spawn egg, /summon, or loaded from disk). */
export function adopt(e, pl, start) {
  if (T.brain && alive(T.brain.e) && T.brain.e.id !== e.id) {
    guard("oldRemove", () => T.brain.e.remove());
    endBrain(T.brain, "replaced");
  }
  const b = createBrain(e, pl, {});
  T.brain = b;
  if (start === "standoff") enterStandoff(b, pl);
  else enterStalk(b, pl);
  return b;
}

function createBrain(e, pl, opts) {
  return {
    e, id: e.id, targetId: pl.id,
    state: "stalk", sub: "", t0: now(),
    mode: "passive", nav: "ground", size: "stand", pose: 0,
    /** @type {Record<string, any>} */ props: {},
    awareness: 10, lastSeenT: -9999,
    /** @type {{x:number,y:number,z:number}|null} */ lastKnown: null, lastKnownT: -9999,
    seenBy: 0, eyeContact: 0, lookAway: 0, reaction: /** @type {string|null} */ (null), reactAt: randInt(14, 50),
    /** @type {any} */ wp: null, /** @type {{x:number,y:number,z:number}|null} */ wpGoal: null, wpT: 0, wpSpeed: 0.2,
    lastPos: { ...e.location }, stuck: 0, progT: now(),
    nextRepos: now() + randInt(160, 300), nextVocal: now() + randInt(60, 200), nextLunge: now() + 80, nextHeavy: now() + 40,
    burstUntil: 0, nextBurst: now() + 120, slowUntil: 0,
    /** @type {any} */ atk: null,
    huntStart: 0, lostSince: 0, onSurfaceSince: 0, surfaceAllow: 0,
    escaped: false, final: !!opts.final, enraged: !!opts.enraged,
    /** @type {{x:number,y:number,z:number}[]} */ spots: [], searchEnd: 0, listenUntil: 0,
    retreatUntil: 0, retreatThen: "vanish", vanishing: false, removeAt: 0,
    standEnd: 0, warned: false, falseLunged: false, closeTicks: 0,
    /** @type {Set<string>} */ spotted: new Set(), /** @type {Set<string>} */ pressured: new Set(),
    escortUntil: 0, encStart: now(), stalkMax: randInt(1100, 2600),
    tunnelWatch: false, ambushUntil: 0, visualHold: 0, visualHoldState: "",
    noiseT: now(), lastTorchT: 0, lastDoorT: 0, climbTicks: 0, crawlHold: 0,
    esc: { pillar: 0, seal: 0, shelter: 0, water: 0, ride: 0 },
    terrS: 0, /** @type {any} */ terr: null, buffT: 0,
    tiltUntil: 0, dormantSince: 0, lastHitT: -9999, tk: 0,
  };
}

// ============================================================================================ low-level helpers
function setProp(b, name, val) {
  if (b.props[name] === val) return;
  b.props[name] = val;
  guard("prop", () => b.e.setProperty("shaftbreaker:" + name, val));
}
function visual(b, st) {
  if (b.visualHold > now() && st !== "vanish" && st !== "death") st = b.visualHoldState;
  setProp(b, "state", st);
}
function holdVisual(b, st, ticks) {
  b.visualHold = now() + ticks;
  b.visualHoldState = st;
  setProp(b, "state", st);
}
function setMode(b, mode) {
  if (b.mode === mode) return;
  b.mode = mode;
  guard("mode", () => b.e.triggerEvent("shaftbreaker:mode_" + mode));
}
function setNav(b, nav) {
  if (b.nav === nav) return;
  b.nav = nav;
  guard("nav", () => b.e.triggerEvent("shaftbreaker:nav_" + nav));
}
function setSize(b, size) {
  if (b.size === size) return;
  b.size = size;
  guard("size", () => b.e.triggerEvent("shaftbreaker:size_" + size));
}
function speed(b, v) {
  guard("speed", () => {
    const m = /** @type {any} */ (b.e.getComponent("minecraft:movement"));
    if (m) m.setCurrentValue(clamp(v, 0, 0.7));
  });
}
function faceTo(b, loc) {
  guard("face", () => {
    const l = b.e.location;
    b.e.setRotation({ x: 0, y: yawOf({ x: loc.x - l.x, y: 0, z: loc.z - l.z }) });
  });
}
/** @returns {import("@minecraft/server").Player | undefined} */
function target(b) {
  const pl = /** @type {any} */ (world.getEntity(b.targetId));
  if (!pl || !alive(pl) || pl.typeId !== "minecraft:player") return undefined;
  return pl;
}
function terrMult(b) { return 1 + (b.terrS > 0.35 ? 0.35 * b.terrS : 0) + (b.enraged ? 0.3 : 0) + (b.final ? 0.4 : 0); }
function aggr(b, pl) { return harmless() ? 0 : aggressionFor(getP(pl)) * terrMult(b); }

function goTo(b, loc, spd) {
  const dim = b.e.dimension;
  const at = center(loc);
  if (!alive(b.wp)) {
    b.wp = null;
    guard("wpSpawn", () => { b.wp = dim.spawnEntity(WAYPOINT_ID, { x: at.x, y: at.y + 0.1, z: at.z }); });
  } else {
    guard("wpMove", () => b.wp.teleport({ x: at.x, y: at.y + 0.1, z: at.z }, { dimension: dim }));
  }
  b.wpGoal = at;
  b.wpT = now();
  b.wpSpeed = spd;
  setMode(b, "seek");
  speed(b, spd);
}
function stopMoving(b) {
  if (alive(b.wp)) guard("wpRemove", () => b.wp.remove());
  b.wp = null;
  b.wpGoal = null;
  setMode(b, "passive");
}
function arrived(b) {
  return !b.wpGoal || distXZ(b.e.location, b.wpGoal) < 1.6 && Math.abs(b.e.location.y - b.wpGoal.y) < 2.5;
}

/** Scripted step (used for slow backing-away and creeping). Returns false if blocked. */
function stepTo(b, dir, stepLen, faceLoc) {
  const e = b.e;
  const l = e.location;
  const n = { x: l.x + dir.x * stepLen, y: l.y, z: l.z + dir.z * stepLen };
  const dim = e.dimension;
  const fx = Math.floor(n.x);
  const fz = Math.floor(n.z);
  let y = Math.floor(l.y + 0.01);
  const need = b.size === "crawl" ? 1 : 2;
  const fits = (yy) => {
    for (let i = 0; i < need; i++) if (!passable(getBlock(dim, { x: fx, y: yy + i, z: fz }))) return false;
    return solid(getBlock(dim, { x: fx, y: yy - 1, z: fz }));
  };
  if (!fits(y)) {
    if (fits(y + 1)) y += 1;
    else if (fits(y - 1)) y -= 1;
    else return false;
  }
  try {
    e.teleport({ x: n.x, y: y + (Math.abs(y - l.y) < 0.6 ? l.y - Math.floor(l.y + 0.01) : 0), z: n.z }, { facingLocation: faceLoc });
    return true;
  } catch {
    return false;
  }
}

function anyoneSees(b) {
  for (const pl of b.e.dimension.getPlayers({ location: b.e.location, maxDistance: 72 })) {
    if (playerSees(pl, b.e, b.pose, b.props.eyes === 0) > 0) return true;
  }
  return false;
}

function vocal(b, id, vol = 1, pitch = 1) {
  guard("vocal", () => b.e.dimension.playSound(id, { x: b.e.location.x, y: b.e.location.y + 2, z: b.e.location.z }, { volume: vol, pitch }));
}

// ============================================================================================ state entries
function enterStalk(b, pl) {
  b.state = "stalk";
  b.sub = "";
  b.t0 = now();
  b.reaction = null;
  b.seenBy = 0;
  b.eyeContact = 0;
  stopMoving(b);
  setSize(b, "stand");
  setProp(b, "eyes", chance(0.3) ? 0 : 1);
  setProp(b, "tilt", false);
  visual(b, chance(0.5) ? "watch" : "stalk");
  speed(b, 0.18);
  if (pl) requestNav(pl, getP(pl));
}

function enterStandoff(b, pl) {
  b.state = "standoff";
  b.t0 = now();
  b.standEnd = now() + randInt(220, 600);
  b.warned = false;
  b.falseLunged = false;
  b.closeTicks = 0;
  b.eyeContact = 0;
  b.lookAway = 0;
  stopMoving(b);
  setProp(b, "eyes", b.enraged || b.final ? 2 : 1);
  visual(b, b.pose >= 1 || b.tunnelWatch ? "stalk" : "watch");
  b.tiltUntil = now() + randInt(60, 160);
  vocal(b, "shaftbreaker.growl", 0.8);
  const p = getP(pl);
  p.profile.standoffs++;
  p.profDirty = true;
  unlock(pl, "standoff");
}

function enterDormant(b) {
  b.state = "dormant";
  b.t0 = now();
  b.dormantSince = now();
  stopMoving(b);
  setProp(b, "eyes", 0);
  visual(b, "dormant");
}

/** Begins the engage phase (scream first unless it is an ambush/provocation). */
export function engage(b, pl, reason) {
  if (!pl) return;
  if (harmless()) { vanish(b, true); return; }
  b.targetId = pl.id;
  stopMoving(b);
  if (reason === "ambush" || reason === "provoked") {
    startHunt(b, pl);
    vocal(b, "shaftbreaker.growl", 1.0, 1.2);
    return;
  }
  b.state = "scream";
  b.t0 = now();
  setProp(b, "eyes", 2);
  setProp(b, "tilt", false);
  holdVisual(b, "scream", 50);
  faceTo(b, pl.getHeadLocation());
  vocal(b, "shaftbreaker.screech", 1.2 * cfg.screamVolume);
  for (const w of b.e.dimension.getPlayers({ location: b.e.location, maxDistance: 48 })) {
    stinger(w, true);
    caption(w, "A deafening shriek");
    if (cfg.screenEffects && dist(w.location, b.e.location) < 24) guard("dark", () => w.addEffect("darkness", 50, { amplifier: 0, showParticles: false }));
  }
}

function startHunt(b, pl) {
  b.state = "hunt";
  b.t0 = now();
  b.huntStart = b.huntStart || now();
  b.lostSince = 0;
  b.onSurfaceSince = 0;
  b.lastKnown = { ...pl.location };
  b.lastKnownT = now();
  b.visualHold = 0;
  for (const other of world.getPlayers({ tags: [PREY_TAG] })) if (other.id !== pl.id) guard("tag", () => other.removeTag(PREY_TAG));
  guard("tag", () => pl.addTag(PREY_TAG));
  setProp(b, "eyes", 2);
  setProp(b, "tilt", false);
  setMode(b, "hunt");
  visual(b, "hunt");
  applyNav(b, pl);
  const p = getP(pl);
  if (!b.countedHunt) {
    b.countedHunt = true;
    p.profile.hunts++;
    p.profDirty = true;
    // surface allowance for this hunt (learned)
    const ab = abilities(p);
    b.surfaceAllow = !cfg.surfacePursuit ? 0 : [chance(0.25) ? 260 : 0, 420, 700, 1000][ab.surface] + (b.final || b.enraged ? 400 : 0);
  }
  unlock(pl, "hunt");
}

function applyNav(b, pl) {
  const ab = abilities(getP(pl));
  const climb = ab.climb >= 1 || b.final;
  const doors = cfg.doors && (ab.doors >= 1 || b.final);
  setNav(b, (climb ? "climb" : "ground") + (doors ? "_doors" : ""));
}

function enterSearch(b, pl) {
  b.state = "search";
  b.t0 = now();
  b.searchEnd = now() + randInt(500, 900);
  b.listenUntil = 0;
  guard("tag", () => pl.removeTag(PREY_TAG));
  setProp(b, "eyes", 1);
  const p = getP(pl);
  const lk = b.lastKnown || pl.location;
  /** @type {{x:number,y:number,z:number}[]} */
  const spots = [{ ...lk }];
  for (const s of p.profile.hide) if (dist({ x: s[0], y: s[1], z: s[2] }, lk) < 28) spots.push({ x: s[0], y: s[1], z: s[2] });
  if (p.nav && p.nav.cells) {
    const near = p.nav.cells.filter((c) => dist(c, lk) < 11 && dist(c, lk) > 3);
    for (let i = 0; i < 3 && near.length; i++) spots.push(near.splice(Math.floor(rand() * near.length), 1)[0]);
  }
  b.spots = spots.slice(0, 5);
  visual(b, "search");
  nextSearchSpot(b);
}

function nextSearchSpot(b) {
  const s = b.spots.shift();
  if (!s) return false;
  goTo(b, s, 0.24 * cfg.speed);
  visual(b, "search");
  return true;
}

function enterAmbush(b, pl, spot) {
  b.state = "ambush";
  b.t0 = now();
  b.ambushUntil = now() + randInt(400, 820);
  stopMoving(b);
  if (spot) guard("ambTp", () => b.e.teleport(center(spot), { facingLocation: pl.getHeadLocation() }));
  setProp(b, "eyes", 0);
  visual(b, "stalk");
}

function startRetreat(b, pl, then = "vanish") {
  b.state = "retreat";
  b.t0 = now();
  b.retreatUntil = now() + randInt(80, 150);
  b.retreatThen = then;
  stopMoving(b);
  setProp(b, "tilt", false);
  visual(b, "retreat");
  void pl;
}

function enterEscort(b) {
  b.state = "escort";
  b.t0 = now();
  b.escortUntil = now() + randInt(120, 240);
  stopMoving(b);
  guard("untag", () => { const pl = target(b); if (pl) pl.removeTag(PREY_TAG); });
  setProp(b, "eyes", 1);
  visual(b, "watch");
}

/** Phase out with particles and a crackle, then remove. */
export function vanish(b, loud = true, then = "remove") {
  if (b.vanishing) return;
  b.vanishing = true;
  b.vanishThen = then;
  b.state = "vanish";
  stopMoving(b);
  setProp(b, "tilt", false);
  setProp(b, "attack", 0);
  visual(b, "vanish");
  const e = b.e;
  const dim = e.dimension;
  if (loud) {
    system.runTimeout(() => guard("vsnd", () => { if (alive(e)) dim.playSound("shaftbreaker.vanish", e.location, { volume: 0.9 }); }), 14);
    system.runTimeout(() => guard("vpart", () => {
      if (!alive(e)) return;
      dim.spawnParticle("shaftbreaker:phase_out", e.location);
      if (!cfg.reducedParticles) dim.spawnParticle("shaftbreaker:phase_out", { x: e.location.x, y: e.location.y + 0.8, z: e.location.z });
    }), 20);
  }
  b.removeAt = now() + (loud ? 30 : 2);
}

/** Leave the area: backs off into the dark if watched, otherwise just goes. */
export function leave(b, reason) {
  const pl = target(b);
  guard("untag", () => { if (pl) pl.removeTag(PREY_TAG); });
  b.leaveReason = reason;
  if (anyoneSees(b) && pl) startRetreat(b, pl, "vanish");
  else vanish(b, false);
}

function escape(b, pl) {
  b.escaped = true;
  vocal(b, "shaftbreaker.screech", 1.1 * cfg.screamVolume, 0.8);
  guard("escFx", () => b.e.dimension.spawnParticle("shaftbreaker:blood_mist", b.e.location));
  if (pl && dist(pl.location, b.e.location) < 7) {
    const dir = flat(sub(pl.location, b.e.location));
    guard("escKb", () => pl.applyKnockback({ x: dir.x * 1.8, z: dir.z * 1.8 }, 0.45));
    guard("escSlow", () => pl.addEffect("slowness", 70, { amplifier: 1, showParticles: true }));
  }
  if (pl) unlock(pl, "wounded");
  b.leaveReason = "escaped";
  vanish(b, true);
}

// ============================================================================================ attacks
function shieldBlocking(pl, e) {
  if (!pl.isSneaking) return false;
  try {
    const eq = /** @type {any} */ (pl.getComponent("minecraft:equippable"));
    const off = eq && eq.getEquipment(EquipmentSlot.Offhand);
    const main = eq && eq.getEquipment(EquipmentSlot.Mainhand);
    const has = (off && off.typeId === "minecraft:shield") || (main && main.typeId === "minecraft:shield");
    if (!has) return false;
    return lookDot(pl, { x: e.location.x, y: e.location.y + 1.5, z: e.location.z }) > 0.25;
  } catch {
    return false;
  }
}

export function disableShield(pl) {
  if (!cfg.shieldDisable) return;
  guard("shield", () => {
    pl.startItemCooldown("shield", 100);
    pl.playSound("random.break", { volume: 0.8, pitch: 0.7 });
  });
}

function hit(b, pl, amount, kb, up = 0.32) {
  const e = b.e;
  if (shieldBlocking(pl, e)) {
    disableShield(pl);
    amount *= 0.35;
  }
  const dir = flat(sub(pl.location, e.location));
  guard("dmg", () => pl.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: e }));
  guard("kb", () => pl.applyKnockback({ x: dir.x * kb, z: dir.z * kb }, up));
  if (cfg.darknessOnHit && cfg.screenEffects) guard("dark", () => pl.addEffect("darkness", 60, { amplifier: 0, showParticles: false }));
  b.lastHitT = now();
}

function tryAttacks(b, pl, v) {
  const t = now();
  const e = b.e;
  if (b.atk) {
    const a = b.atk;
    const dir = flat(sub(pl.location, e.location));
    if (a.kind === "lunge") {
      if (t === a.t + 6 || (t > a.t + 6 && !a.jumped)) {
        a.jumped = true;
        guard("lungeImp", () => e.applyImpulse({ x: dir.x * 1.15, y: 0.28, z: dir.z * 1.15 }));
      }
      if (!a.done && t >= a.t + 11) {
        a.done = true;
        const d = dist(pl.location, e.location);
        if (d < 2.8 && clearLine(e.dimension, { x: e.location.x, y: e.location.y + 1.4, z: e.location.z }, pl.getHeadLocation())) {
          hit(b, pl, DMG[cfg.tier] || 7, 1.1);
        } else b.slowUntil = t + 26; // missed: real recovery window
      }
    } else if (a.kind === "heavy") {
      if (!a.done && t >= a.t + 9) {
        a.done = true;
        const d = dist(pl.location, e.location);
        if (d < 5.2 && clearLine(e.dimension, { x: e.location.x, y: e.location.y + 2.4, z: e.location.z }, pl.getHeadLocation())) {
          hit(b, pl, (DMG[cfg.tier] || 7) * 1.25, 0.8, 0.5);
        } else b.slowUntil = t + 30;
      }
    }
    if (t >= a.end) {
      b.atk = null;
      setProp(b, "attack", 0);
    }
    return;
  }
  if (!v.cSees) return;
  const dy = pl.location.y - e.location.y;
  const hd = distXZ(pl.location, e.location);
  // long-reach overhead strike at players standing above it (pillars, ledges)
  if (t >= b.nextHeavy && dy > 1.5 && dy < 4.9 && hd < 3.4) {
    b.atk = { kind: "heavy", t, end: t + 20, done: false };
    b.nextHeavy = t + randInt(50, 80);
    setProp(b, "attack", 2);
    faceTo(b, pl.location);
    return;
  }
  // committed lunge across a gap
  if (t >= b.nextLunge && hd > 3.4 && hd < 7.5 && Math.abs(dy) < 1.4 && b.size === "stand") {
    let onGround = true;
    try { onGround = e.isOnGround; } catch { /* */ }
    if (!onGround) return;
    b.atk = { kind: "lunge", t, end: t + 18, done: false, jumped: false };
    b.nextLunge = t + randInt(70, 140);
    setProp(b, "attack", 1);
    faceTo(b, pl.location);
    vocal(b, "shaftbreaker.attack_snarl", 0.9);
  }
}

// ============================================================================================ perception per tick
function perceive(b, pl) {
  const e = b.e;
  const d = dist(e.location, pl.location);
  const sees = playerSees(pl, e, b.pose, b.props.eyes === 0);
  const range = 34 + playerLightBonus(pl) + (b.terrS > 0.3 ? 16 : 0);
  const cSees = d < range && creatureSees(e, b.pose, pl, range, b.state === "search" || b.state === "hunt");
  if (cSees) {
    b.lastSeenT = now();
    b.lastKnown = { ...pl.location };
    b.lastKnownT = now();
  }
  return { d, sees, cSees };
}

/** Spotting reactions for every player that can see it (stinger once per encounter, journal, learning). */
function witnesses(b) {
  const e = b.e;
  for (const w of e.dimension.getPlayers({ location: e.location, maxDistance: 64 })) {
    if (b.spotted.has(w.id)) continue;
    const s = playerSees(w, e, b.pose, b.props.eyes === 0);
    if (!s) continue;
    b.spotted.add(w.id);
    const p = getP(w);
    p.spottedAt = now();
    p.profile.sightings++;
    p.profDirty = true;
    if (b.state !== "hunt" && b.state !== "scream") stinger(w, s === 2);
    unlock(w, "sighting");
    if (b.tunnelWatch) unlock(w, "tunnel");
  }
}

function processNoises(b, pl) {
  const e = b.e;
  let best = null;
  for (const n of noises) {
    if (n.t <= b.noiseT) continue;
    const d = dist(n, e.location);
    let r = n.r * (b.terrS > 0.3 ? 1.4 : 1);
    if (d > r && podHears(n)) r = d + 1; // listening organs relay what they hear
    if (d <= r && (!best || n.r > best.r)) best = n;
  }
  b.noiseT = now();
  if (!best) return null;
  if (best.kind === "lure") {
    const eff = habituation(getP(pl).profile.lure);
    if (!chance(0.25 + 0.75 * eff)) return null;
  }
  b.awareness = Math.min(100, b.awareness + (best.kind === "explosion" ? 25 : best.kind === "organ" ? 40 : 8));
  return best;
}

// ============================================================================================ vantage selection
function chooseVantage(b, pl, opts = {}) {
  const p = getP(pl);
  requestNav(pl, p);
  const cells = p.nav && p.nav.cells;
  if (!cells || cells.length < 8) return null;
  const head = pl.getHeadLocation();
  const minD = opts.minD ?? 14;
  const maxD = opts.maxD ?? 36;
  const lookBackHabit = p.profile.lookBack >= 4;
  const scored = [];
  const n = Math.min(cells.length, 500);
  for (let i = 0; i < n; i++) {
    const c = cells.length > 500 ? cells[Math.floor(rand() * cells.length)] : cells[i];
    if (c.water) continue;
    const pos = { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
    const d = dist(pos, pl.location);
    if (d < minD || d > maxD) continue;
    const top = { x: pos.x, y: pos.y + (c.tall ? 2.4 : 1.6), z: pos.z };
    const ld = lookDot(pl, top);
    if (ld > (opts.allowInView ? 0.98 : 0.42)) continue;
    let s = rand() * 3;
    if (lookBackHabit) s += Math.abs(ld) < 0.35 ? 4 : 0;
    else s += ld < -0.3 ? 4 : 0;
    if (c.y > pl.location.y + 2.5) s += 3;
    if (!c.tall) s += 1.5;
    if (opts.near) s -= dist(pos, opts.near) * 0.4;
    if (opts.tunnel && p.tunnel) s += Math.max(0, 8 - dist(pos, p.tunnel.start));
    scored.push({ c, pos, top, s });
  }
  scored.sort((a, b2) => b2.s - a.s);
  for (let i = 0; i < Math.min(14, scored.length); i++) {
    const cand = scored[i];
    if (opts.hidden) {
      if (!clearLine(pl.dimension, head, cand.top)) return cand;
      continue;
    }
    if (clearLine(pl.dimension, cand.top, head)) {
      let light = 0;
      try { light = pl.dimension.getLightLevel({ x: cand.c.x, y: cand.c.y + 1, z: cand.c.z }); } catch { /* */ }
      if (light <= 7 || i > 8) return cand;
    }
  }
  return null;
}

function reposition(b, pl, opts = {}) {
  const p = getP(pl);
  const tunnelPref = !!p.tunnel && (p.profile.strip >= 2 || chance(0.35));
  const v = chooseVantage(b, pl, { ...opts, tunnel: tunnelPref });
  b.nextRepos = now() + Math.floor(randInt(170, 420) * (b.terrS > 0.3 ? 0.7 : 1));
  if (!v) return false;
  const e = b.e;
  const from = { ...e.location };
  if (dist(from, v.pos) < 9 && chance(0.6)) {
    goTo(b, v.c, 0.17); // short walks are physical (and silent while creeping)
    b.sub = "walk";
  } else {
    guard("repTp", () => e.teleport(v.pos, { facingLocation: pl.getHeadLocation() }));
    b.sub = "";
    // misleading movement sounds: either along its real route or mirrored to the other side
    const mid = mul(add(from, v.pos), 0.5);
    const mirrored = { x: 2 * pl.location.x - mid.x, y: mid.y, z: 2 * pl.location.z - mid.z };
    if (chance(0.55)) guard("mvSnd", () => e.dimension.playSound(chance(0.3) ? "shaftbreaker.crawl" : "shaftbreaker.move_far", chance(0.5) ? mid : mirrored, { volume: 0.8 }));
  }
  b.tunnelWatch = tunnelPref && p.tunnel && dist(v.pos, p.tunnel.start) < 6;
  setProp(b, "eyes", b.tunnelWatch ? 1 : chance(0.3) ? 0 : 1);
  // corner peeks when a wall is right beside it
  const dim = e.dimension;
  const toP = flat(sub(pl.location, v.pos));
  const left = { x: -toP.z, y: 0, z: toP.x };
  const wallL = solid(getBlock(dim, { x: v.pos.x + left.x, y: v.pos.y + 1, z: v.pos.z + left.z }));
  const wallR = solid(getBlock(dim, { x: v.pos.x - left.x, y: v.pos.y + 1, z: v.pos.z - left.z }));
  if ((wallL || wallR) && chance(0.4)) visual(b, wallL ? "peek_r" : "peek_l");
  else visual(b, v.c.tall && chance(0.55) ? "watch" : "stalk");
  b.reaction = null;
  b.seenBy = 0;
  return true;
}

/** Teleport (unseen) to a reachable spot near the player — anti-stuck "it found another way". */
function relocateNear(b, pl, minD, maxD) {
  const v = chooseVantage(b, pl, { minD, maxD, hidden: true });
  if (!v) return false;
  guard("reloc", () => b.e.teleport(v.pos, { facingLocation: pl.getHeadLocation() }));
  b.stuck = 0;
  b.lastPos = { ...v.pos };
  return true;
}

// ============================================================================================ upkeep
function upkeep(b, pl) {
  const e = b.e;
  const t = now();
  // never stay trapped in boats / minecarts
  const riding = /** @type {any} */ (e.getComponent("minecraft:riding"));
  if (riding && riding.entityRidingOn) {
    const veh = riding.entityRidingOn;
    guard("unride", () => { veh.kill(); });
    vocal(b, "shaftbreaker.smash", 1.0);
  }
  // territory buffs
  if (t - b.buffT >= 40) {
    b.buffT = t;
    const tr = territoryAt(e.location);
    b.terr = tr;
    b.terrS = tr ? tr.s : 0;
    if (tr && tr.s > 0.35) {
      const oh = organHealth(tr.h.id);
      guard("buff", () => {
        e.addEffect("strength", 60, { amplifier: 0, showParticles: false });
        if (oh > 0.3) e.addEffect("resistance", 60, { amplifier: 0, showParticles: false });
        const hp = /** @type {any} */ (e.getComponent("minecraft:health"));
        if (hp && oh > 0.3 && hp.currentValue < hp.effectiveMax) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + 2));
      });
      const rage = W.hollows[tr.h.id] ? W.hollows[tr.h.id].rage : 0;
      if (rage > 40 && b.state !== "dormant") b.enraged = true;
    }
  }
  // pose: crouch under low ceilings, crawl through 1-high gaps
  if (b.tk % 2 === 0) {
    const l = e.location;
    const dim = e.dimension;
    const c1 = passable(getBlock(dim, { x: l.x, y: l.y + 1.1, z: l.z }));
    const c2 = passable(getBlock(dim, { x: l.x, y: l.y + 2.05, z: l.z }));
    const c3 = passable(getBlock(dim, { x: l.x, y: l.y + 3.0, z: l.z }));
    const wantCrawl = (b.state === "hunt" || b.state === "search") && pl && inLowSpace(pl) && dist(pl.location, l) < 26;
    if (wantCrawl || !c1) { setSize(b, "crawl"); b.crawlHold = t + 60; }
    else if (b.size === "crawl" && t > b.crawlHold && c1 && c2) setSize(b, "stand");
    b.pose = b.size === "crawl" ? 2 : (!c2 || !c3) ? 1 : 0;
    setProp(b, "pose", b.pose);
  }
  // water: keep pushing toward its prey instead of being carried by currents
  let inWater = false;
  try { inWater = e.isInWater; } catch { /* */ }
  b.inWater = inWater;
  if (inWater && pl && (b.state === "hunt" || b.state === "search")) {
    const dir = norm(sub(pl.location, e.location));
    guard("swimImp", () => e.applyImpulse({ x: dir.x * 0.05, y: dir.y > 0.2 ? 0.06 : 0.01, z: dir.z * 0.05 }));
    if (b.visualHold < t) visual(b, "swim");
  }
  if (b.tiltUntil && t > b.tiltUntil && (b.state === "standoff" || b.state === "stalk") && chance(0.02)) setProp(b, "tilt", true);
  if (b.state !== "standoff" && b.state !== "stalk" && b.props.tilt) setProp(b, "tilt", false);
}

function stuckCheck(b, pl, goal) {
  const t = now();
  if (t - b.progT < 20) return;
  b.progT = t;
  const e = b.e;
  const moved = dist(e.location, b.lastPos);
  b.lastPos = { ...e.location };
  if (!goal) { b.stuck = 0; return; }
  if (moved < 0.45 && dist(e.location, goal) > 2.9) b.stuck += 20;
  else b.stuck = Math.max(0, b.stuck - 20);
  if (b.stuck < 40) return;
  const p = pl ? getP(pl) : null;
  const ab = p ? abilities(p) : { climb: 0, break: 0, doors: 0 };
  const dy = goal.y - e.location.y;
  const dim = e.dimension;
  // a door in the way?
  const door = findDoor(dim, e.location, 2);
  if (door && cfg.doors && (ab.doors >= 1 || b.stuck >= 160 || b.final)) {
    if (setDoor(door, true)) { b.stuck = 0; b.esc.shelter++; return; }
  }
  // climb toward prey above
  if (dy > 1.5 && (ab.climb >= 1 || b.stuck >= 120 || b.final)) {
    b.climbTicks = 40;
    if (pl && pl.location.y - e.location.y > 2.5) b.esc.pillar++;
    return;
  }
  // smash through natural stone / basic walls
  if (cfg.breakMode > 0 && (ab.break >= 1 || b.stuck >= 140 || b.final || b.enraged)) {
    const mode = Math.min(cfg.breakMode, ab.break >= 2 || b.final || b.enraged ? 2 : 1);
    const r = smashToward(e, goal, mode, b.size === "crawl");
    if (r > 0) {
      holdVisual(b, "break", 30);
      b.stuck = 10;
      if (p && t - p.lastPlace < 600) b.esc.seal++;
      return;
    }
  }
  if (b.stuck >= 160 && pl && !anyoneSees(b)) {
    if (relocateNear(b, pl, 7, 15)) return;
  }
  if (b.stuck >= 260 && b.state === "search") { b.stuck = 0; if (!nextSearchSpot(b)) leave(b, "lost"); }
}

function climbAssist(b, goal) {
  if (b.climbTicks <= 0) return;
  b.climbTicks--;
  const e = b.e;
  const dim = e.dimension;
  const dir = flat(sub(goal, e.location));
  const l = e.location;
  const wall = solid(getBlock(dim, { x: l.x + dir.x * 0.8, y: l.y + 0.5, z: l.z + dir.z * 0.8 }))
    || solid(getBlock(dim, { x: l.x + dir.x * 0.8, y: l.y + 1.5, z: l.z + dir.z * 0.8 }));
  const roof = solid(getBlock(dim, { x: l.x, y: l.y + 2.1, z: l.z }));
  if (wall && !roof && goal.y > l.y + 0.5) {
    guard("climbImp", () => e.applyImpulse({ x: dir.x * 0.04, y: 0.36, z: dir.z * 0.04 }));
    holdVisual(b, "climb", 6);
    if (chance(0.08)) vocal(b, "shaftbreaker.climb", 0.8);
  } else if (!wall) b.climbTicks = Math.min(b.climbTicks, 4);
}

// ============================================================================================ main tick
export function brainTick() {
  const b = T.brain;
  if (!b) return;
  if (!alive(b.e)) { endBrain(b, b.vanishing ? (b.leaveReason || "vanished") : "lost"); return; }
  if (b.removeAt && now() >= b.removeAt) {
    // phased out, but not gone: it reappears somewhere out of sight and keeps watching
    if (b.vanishThen === "stalk" && cfg.enabled) {
      const tp = target(b);
      const v = tp ? chooseVantage(b, tp, { hidden: true, minD: 16, maxD: 36 }) : null;
      if (tp && v) {
        b.vanishing = false;
        b.removeAt = 0;
        b.vanishThen = "remove";
        guard("reappear", () => b.e.teleport(v.pos, { facingLocation: tp.getHeadLocation() }));
        enterStalk(b, tp);
        b.nextRepos = now() + randInt(200, 420);
        return;
      }
    }
    guard("remove", () => b.e.remove());
    endBrain(b, b.leaveReason || "vanished");
    return;
  }
  if (b.vanishing) return;
  b.tk = (b.tk || 0) + 1;
  if (!cfg.enabled) { vanish(b, false); return; }
  let pl = target(b);
  if (!pl || pl.dimension.id !== b.e.dimension.id || !eligible(pl) || dist(pl.location, b.e.location) > 140) {
    const others = b.e.dimension.getPlayers({ location: b.e.location, maxDistance: 64 }).filter(eligible);
    if (others.length && b.state !== "dormant") {
      pl = others[0];
      b.targetId = pl.id;
      // turn and re-orient before changing targets
      faceTo(b, pl.getHeadLocation());
      vocal(b, "shaftbreaker.click", 0.8);
    } else if (b.state !== "dormant") {
      leave(b, "no_target");
      return;
    }
  }
  witnesses(b);
  upkeep(b, pl);
  switch (b.state) {
    case "stalk": tickStalk(b, pl); break;
    case "standoff": tickStandoff(b, pl); break;
    case "scream": if (now() - b.t0 >= 50) startHunt(b, pl); break;
    case "hunt": tickHunt(b, pl); break;
    case "search": tickSearch(b, pl); break;
    case "ambush": tickAmbush(b, pl); break;
    case "retreat": tickRetreat(b, pl); break;
    case "escort": tickEscort(b, pl); break;
    case "dormant": tickDormant(b, pl); break;
    default: break;
  }
}

// ---------------------------------------------------------------------------------------------- stalk
function tickStalk(b, pl) {
  if (!pl) return;
  const t = now();
  const v = perceive(b, pl);
  const p = getP(pl);
  const a = aggr(b, pl);
  if (v.cSees) b.awareness = Math.min(100, b.awareness + 0.6);
  else b.awareness = Math.max(0, b.awareness - 0.15);
  if (b.mode === "seek") {
    if (arrived(b) || t - b.wpT > 260) { stopMoving(b); visual(b, chance(0.5) ? "watch" : "stalk"); }
    else stuckCheck(b, pl, b.wpGoal);
  }
  if (!p.underground && p.surfTicks > 160) { enterEscort(b); return; }
  if (v.sees) {
    b.seenBy += 2;
    b.lookAway = 0;
    if (v.sees === 2) b.eyeContact += 2;
    else b.eyeContact = Math.max(0, b.eyeContact - 1);
    if (b.mode !== "seek") faceTo(b, pl.getHeadLocation());
    if (v.d < 11 || (b.eyeContact > 30 && v.d < 26) || (b.tunnelWatch && b.seenBy > 10)) { enterStandoff(b, pl); return; }
    if (!b.reaction && b.seenBy > b.reactAt) {
      b.reaction = weighted({ stare: 3, withdraw: 3, vanish: 2 + (v.d < 18 ? 1 : 0), duck: 2, approach: 1.2 * a, standoff: (v.d < 24 ? 2 : 0.6) * a });
      b.reactAt = randInt(14, 50);
      b.reactT = t;
      if (b.reaction === "withdraw") startRetreat(b, pl, "stalk");
      else if (b.reaction === "vanish") vanish(b, true, chance(0.65) ? "stalk" : "remove");
      else if (b.reaction === "standoff") enterStandoff(b, pl);
      else if (b.reaction === "duck") {
        const c = chooseVantage(b, pl, { minD: Math.max(6, v.d - 6), maxD: v.d + 6, hidden: true, near: b.e.location });
        if (c && dist(c.pos, b.e.location) < 9) goTo(b, c.c, 0.3);
        else startRetreat(b, pl, "stalk");
      } else if (b.reaction === "approach") {
        const dir = flat(sub(pl.location, b.e.location));
        const goal = { x: b.e.location.x + dir.x * 4, y: b.e.location.y, z: b.e.location.z + dir.z * 4 };
        goTo(b, goal, 0.14);
        visual(b, "stalk");
      } else if (b.reaction === "stare") {
        if (chance(0.5)) b.tiltUntil = t + 20;
      }
    } else if (b.reaction === "stare" && t - (b.reactT || t) > randInt(60, 140)) {
      b.reaction = null;
      b.seenBy = Math.floor(b.reactAt * 0.5);
    }
    return;
  }
  // ---- unseen
  b.seenBy = Math.max(0, b.seenBy - 1);
  b.eyeContact = 0;
  b.lookAway += 2;
  if (b.lookAway > 40) b.reaction = null;
  if (v.d < 22 && !b.pressured.has(pl.id)) {
    b.pressured.add(pl.id);
    guard("press", () => pl.playSound("shaftbreaker.pressure", { volume: 0.8 }));
  }
  if (v.d < 9 && chance(0.04)) vocal(b, "shaftbreaker.breath", 0.9);
  if (v.d < 20 && chance(0.008)) vocal(b, "shaftbreaker.click", 0.7);
  const heard = processNoises(b, pl);
  if (heard && b.mode !== "seek" && dist(heard, b.e.location) > 4) {
    // investigate the sound - but stop short and watch from the dark
    const toN = flat(sub(heard, b.e.location));
    const goal = { x: heard.x - toN.x * 6, y: heard.y, z: heard.z - toN.z * 6 };
    goTo(b, goal, 0.2);
    visual(b, "search");
    return;
  }
  if (b.mode !== "seek" && t >= b.nextRepos && b.lookAway > 40) reposition(b, pl);
  else if (b.mode !== "seek" && v.d > 16 && b.lookAway > 60 && chance(0.012 * Math.max(0.5, a))) {
    // creep closer while you're not looking
    const c = chooseVantage(b, pl, { minD: Math.max(10, v.d - 8), maxD: v.d - 3, near: b.e.location });
    if (c) goTo(b, c.c, 0.15);
  }
  // escalation
  if (t - b.encStart > b.stalkMax || b.awareness >= 100) {
    b.encStart = t;
    b.stalkMax = randInt(900, 1800);
    const choice = harmless() ? "leave" : weighted({ ambush: 1.6 * a, hunt: 0.8 * a * (b.enraged ? 2 : 1), leave: 1.6, stalk: 1.2 });
    if (choice === "hunt") engage(b, pl, "scream");
    else if (choice === "ambush") {
      const spot = chooseVantage(b, pl, { minD: 9, maxD: 18, hidden: true });
      if (spot) enterAmbush(b, pl, spot.c);
    } else if (choice === "leave") {
      leave(b, "bored");
      scratchAfter(b, pl);
    }
  }
}

/** Claw marks left near where it watched. */
function scratchAfter(b, pl) {
  const p = getP(pl);
  const lvl = Math.min(3, Math.floor(p.profile.enc / 3));
  const at = { ...b.e.location };
  system.runTimeout(() => guard("scratch", () => scratchWalls(pl.dimension, at, randInt(2, 4 + lvl), lvl)), 40);
}

// ---------------------------------------------------------------------------------------------- standoff
function tickStandoff(b, pl) {
  if (!pl) return;
  const t = now();
  const v = perceive(b, pl);
  const a = aggr(b, pl);
  faceTo(b, pl.getHeadLocation());
  if (b.visualHold < t) visual(b, b.pose >= 1 || b.tunnelWatch ? "stalk" : "watch");
  if (b.tiltUntil && t > b.tiltUntil && !b.props.tilt && chance(0.05)) setProp(b, "tilt", true);
  // contact: touching it is a mistake
  if (v.d < 2.4) {
    if (a > 0 && chance(clamp(0.6 + a * 0.3, 0, 0.95))) engage(b, pl, chance(0.5) ? "provoked" : "scream");
    else vanish(b, true);
    return;
  }
  if (v.d < 4.2) b.closeTicks += 2; else b.closeTicks = Math.max(0, b.closeTicks - 1);
  if (b.closeTicks > 36 && a > 0 && chance(0.12 * a)) { engage(b, pl, "scream"); return; }
  if (v.d < 6.5 && !b.warned) {
    b.warned = true;
    holdVisual(b, "threat", 50);
    vocal(b, "shaftbreaker.growl", 1.0, 0.9);
    caption(pl, "A low warning growl");
  }
  if (v.sees) {
    b.lookAway = 0;
    if (v.sees === 2) b.eyeContact += 2;
    if (b.eyeContact > 40 && b.tk % 10 === 0) {
      const pEsc = (b.eyeContact > 120 ? 0.14 : 0.06) * a;
      if (chance(pEsc)) { engage(b, pl, "scream"); return; }
      if (chance(0.04)) { vanish(b, true); return; }
      if (chance(0.06)) vocal(b, "shaftbreaker.jaw", 0.8);
    }
  } else {
    b.lookAway += 2;
    if (b.lookAway === 20 || b.lookAway === 21) {
      const r = weighted({ approach: 2 * Math.max(0.3, a), vanish: 1.5, retreat: 1, stay: 2 });
      if (r === "approach") {
        const dir = flat(sub(b.e.location, pl.location));
        const step = Math.min(v.d - 3, randInt(2, 4));
        if (step > 0.8) {
          const goal = { x: b.e.location.x - dir.x * step, y: b.e.location.y, z: b.e.location.z - dir.z * step };
          const gb = getBlock(b.e.dimension, goal);
          const gh = getBlock(b.e.dimension, { x: goal.x, y: goal.y + 1, z: goal.z });
          const gg = getBlock(b.e.dimension, { x: goal.x, y: goal.y - 1, z: goal.z });
          if (passable(gb) && passable(gh) && solid(gg) && !anyoneSees(b)) guard("closer", () => b.e.teleport({ x: goal.x, y: b.e.location.y, z: goal.z }, { facingLocation: pl.getHeadLocation() }));
        }
      } else if (r === "vanish") { if (!anyoneSees(b)) vanish(b, false); else vanish(b, true); return; }
      else if (r === "retreat") { startRetreat(b, pl, "vanish"); return; }
    }
  }
  // false lunge: stops short (intimidation, never damage)
  if (!b.falseLunged && v.d > 4 && v.d < 8.5 && chance(0.005 * Math.max(0.4, a))) {
    b.falseLunged = true;
    setProp(b, "attack", 3);
    vocal(b, "shaftbreaker.attack_snarl", 1.0);
    system.runTimeout(() => guard("fl", () => setProp(b, "attack", 0)), 18);
  }
  // it sometimes attacks for no reason at all
  if (a > 0 && chance(0.0016 * a)) { engage(b, pl, "scream"); return; }
  if (t > b.standEnd) {
    const r = harmless() ? pick(["vanish", "retreat"]) : weighted({ vanish: 3, retreat: 2, engage: 3 * a, ambush: 1 });
    if (r === "engage") engage(b, pl, "scream");
    else if (r === "retreat") startRetreat(b, pl, "vanish");
    else if (r === "ambush") {
      const spot = chooseVantage(b, pl, { minD: 9, maxD: 18, hidden: true });
      if (spot && !anyoneSees(b)) enterAmbush(b, pl, spot.c);
      else vanish(b, true);
    } else vanish(b, true);
    scratchAfter(b, pl);
  }
}

// ---------------------------------------------------------------------------------------------- hunt
function tickHunt(b, pl) {
  if (!pl) return;
  const t = now();
  const e = b.e;
  const v = perceive(b, pl);
  const p = getP(pl);
  if (!pl.hasTag(PREY_TAG)) guard("tag", () => pl.addTag(PREY_TAG));
  if (b.tk % 20 === 0) applyNav(b, pl);
  // speed: bursts of acceleration followed by recovery
  if (t >= b.nextBurst) { b.burstUntil = t + randInt(30, 52); b.nextBurst = t + randInt(110, 190); }
  let sp = 0.3 * cfg.speed * (1 + 0.14 * b.terrS * (b.terr ? organHealth(b.terr.h.id) : 0)) * (b.final ? 1.12 : 1) * (b.enraged ? 1.07 : 1);
  if (t < b.burstUntil) sp *= 1.33;
  if (t < b.slowUntil) sp *= 0.5;
  speed(b, sp);
  tryAttacks(b, pl, v);
  if (b.visualHold < t) visual(b, b.inWater ? "swim" : "hunt");
  // break the boat / minecart its prey is hiding in
  const r = /** @type {any} */ (pl.getComponent("minecraft:riding"));
  if (r && r.entityRidingOn && v.d < 4.5) {
    const veh = r.entityRidingOn;
    guard("vehKill", () => veh.kill());
    vocal(b, "shaftbreaker.smash", 1.1);
    b.esc.ride++;
  }
  // open doors on the way
  if (cfg.doors && t - b.lastDoorT > 30) {
    const ab = abilities(p);
    if (ab.doors >= 1 || b.final) {
      const door = findDoor(e.dimension, e.location, 2);
      if (door) {
        b.lastDoorT = t;
        setDoor(door, true);
        if (ab.doors >= 2 && chance(0.25)) tauntDoor(door, 2);
      }
    }
  }
  // torches near its path go out (learned)
  if (t - b.lastTorchT > 120) {
    const ab = abilities(p);
    if (ab.torch >= 1 || cfg.torchMode >= 2) { b.lastTorchT = t; extinguishTorches(pl, e.location, 1, 5); }
  }
  if (pl.location.y - e.location.y > 3 && distXZ(pl.location, e.location) < 4) b.esc.pillar += 0.1;
  try { if (pl.isInWater) b.esc.water += 0.05; } catch { /* */ }
  climbAssist(b, pl.location);
  stuckCheck(b, pl, pl.location);
  if (b.tk % 15 === 0 && chance(0.25)) vocal(b, chance(0.5) ? "shaftbreaker.growl" : "shaftbreaker.click", 0.9);
  // lost sight -> search
  if (!v.cSees) { if (!b.lostSince) b.lostSince = t; } else b.lostSince = 0;
  if (b.lostSince && t - b.lostSince > 150 && v.d > 8) { enterSearch(b, pl); return; }
  // surface pursuit is limited (learned)
  if (!p.underground) {
    if (!b.onSurfaceSince) b.onSurfaceSince = t;
    if (t - b.onSurfaceSince > b.surfaceAllow) {
      noteEscape(p, "surface");
      noteSpot(p.profile.routes, pl.location);
      enterEscort(b);
      return;
    }
    unlock(pl, "surface");
  } else b.onSurfaceSince = 0;
  // badly hurt: it tries to get away
  const hp = /** @type {any} */ (e.getComponent("minecraft:health"));
  if (hp && cfg.lowHealthEscape && !b.escaped && hp.currentValue < hp.effectiveMax * (b.final ? 0.12 : 0.3)) { escape(b, pl); return; }
  if (t - b.huntStart > cfg.maxHuntSeconds * 20 * (b.final ? 1.6 : 1)) {
    endHuntLearning(b, pl);
    leave(b, "hunt_timeout");
  }
}

function endHuntLearning(b, pl) {
  const p = getP(pl);
  const e = b.esc;
  const style = e.pillar > 1.5 ? "pillar" : e.seal >= 1 ? "seal" : e.shelter >= 1 ? "shelter" : e.ride >= 1 ? "ride" : e.water > 3 ? "water" : "run";
  noteEscape(p, style);
  noteSpot(p.profile.hide, pl.location);
  if (b.lastKnown) noteSpot(p.profile.routes, b.lastKnown);
  unlock(pl, "escape");
}

// ---------------------------------------------------------------------------------------------- search
function tickSearch(b, pl) {
  if (!pl) return;
  const t = now();
  const v = perceive(b, pl);
  if (v.cSees && v.d < 30) {
    vocal(b, "shaftbreaker.growl", 1.0, 1.1);
    startHunt(b, pl);
    return;
  }
  const heard = processNoises(b, pl);
  if (heard) { b.spots.unshift({ x: heard.x, y: heard.y, z: heard.z }); b.listenUntil = 0; nextSearchSpot(b); }
  if (b.listenUntil) {
    if (t >= b.listenUntil) {
      b.listenUntil = 0;
      setProp(b, "tilt", false);
      if (!nextSearchSpot(b)) finishSearch(b, pl);
    }
    return;
  }
  stuckCheck(b, pl, b.wpGoal);
  if (b.mode === "seek" && (arrived(b) || t - b.wpT > 300)) {
    stopMoving(b);
    b.listenUntil = t + randInt(40, 80);
    visual(b, "watch");
    if (chance(0.5)) setProp(b, "tilt", true);
    vocal(b, chance(0.5) ? "shaftbreaker.breath" : "shaftbreaker.click", 0.9);
  } else if (b.mode !== "seek" && !b.listenUntil) {
    if (!nextSearchSpot(b)) finishSearch(b, pl);
  }
  if (t > b.searchEnd) finishSearch(b, pl);
}

function finishSearch(b, pl) {
  endHuntLearning(b, pl);
  // a false retreat: it pretends to leave, then waits once along the way out
  if (!harmless() && chance(0.25)) {
    const spot = chooseVantage(b, pl, { minD: 8, maxD: 16, hidden: true });
    if (spot && !anyoneSees(b)) { enterAmbush(b, pl, spot.c); b.ambushUntil = now() + randInt(300, 500); b.falseRetreat = true; return; }
  }
  leave(b, "search_over");
}

// ---------------------------------------------------------------------------------------------- ambush
function tickAmbush(b, pl) {
  if (!pl) return;
  const v = perceive(b, pl);
  faceTo(b, pl.getHeadLocation());
  if (v.d < 6 && (v.sees || v.d < 3.6)) {
    if (aggr(b, pl) > 0) {
      setProp(b, "eyes", 2);
      startHunt(b, pl);
      b.nextLunge = now();
      vocal(b, "shaftbreaker.attack_snarl", 1.1);
    } else enterStandoff(b, pl);
    return;
  }
  if (v.sees === 2 && v.d < 16) { enterStandoff(b, pl); return; }
  if (now() > b.ambushUntil) {
    if (b.falseRetreat) leave(b, "false_retreat_over");
    else enterStalk(b, pl);
  }
}

// ---------------------------------------------------------------------------------------------- retreat (backs into the dark facing you)
function tickRetreat(b, pl) {
  const t = now();
  if (!pl) { vanish(b, false); return; }
  const v = perceive(b, pl);
  const away = flat(sub(b.e.location, pl.location));
  const moved = stepTo(b, away, 0.085, pl.getHeadLocation());
  if (!v.sees) b.lookAway += 2; else b.lookAway = 0;
  const done = !moved || t > b.retreatUntil || b.lookAway > 24;
  if (!done) return;
  if (b.retreatThen === "stalk" && !anyoneSees(b)) {
    enterStalk(b, pl);
    b.nextRepos = now() + 20;
  } else vanish(b, anyoneSees(b));
}

// ---------------------------------------------------------------------------------------------- escort (watches you leave its domain)
function tickEscort(b, pl) {
  if (pl) faceTo(b, pl.getHeadLocation());
  if (now() > b.escortUntil) {
    unlock(pl, "escort");
    if (anyoneSees(b) && pl) startRetreat(b, pl, "vanish");
    else vanish(b, false);
  }
}

// ---------------------------------------------------------------------------------------------- dormant (resting in a Dwelling)
function tickDormant(b, pl) {
  const t = now();
  const near = b.e.dimension.getPlayers({ location: b.e.location, maxDistance: 48 }).filter(eligible);
  if (!near.length) {
    if (t - b.dormantSince > 600) vanish(b, false);
    return;
  }
  b.dormantSince = t;
  const closest = near.sort((x, y) => dist(x.location, b.e.location) - dist(y.location, b.e.location))[0];
  const d = dist(closest.location, b.e.location);
  b.targetId = closest.id;
  const heard = processNoises(b, closest);
  if (d < 7.5 || (heard && dist(heard, b.e.location) < 12)) {
    vocal(b, "shaftbreaker.jaw", 1.0);
    setProp(b, "eyes", 1);
    enterStandoff(b, closest);
    holdVisual(b, "threat", 40);
  } else if (chance(0.01)) vocal(b, "shaftbreaker.breath", 0.6, 0.8);
  void pl;
}

// ============================================================================================ external notifications
/** Something (organ, moth) saw the player. */
export function notice(loc, pl) {
  const b = T.brain;
  if (!b || b.vanishing || !alive(b.e)) return;
  if (b.e.dimension.id !== pl.dimension.id) return;
  b.lastKnown = { ...loc };
  b.lastKnownT = now();
  b.awareness = Math.min(100, b.awareness + 20);
  if (b.state === "search") { b.spots.unshift({ ...loc }); if (!b.listenUntil) nextSearchSpot(b); }
  if (b.state === "hunt") b.lostSince = 0;
}

/** An organ was destroyed. */
export function organOutrage(loc, pl) {
  const b = T.brain;
  if (!b || b.vanishing || !alive(b.e)) return false;
  if (b.e.dimension.id !== pl.dimension.id || dist(b.e.location, loc) > 110) return false;
  b.enraged = true;
  if (b.state === "stalk" || b.state === "standoff" || b.state === "ambush" || b.state === "dormant" || b.state === "search") {
    b.targetId = pl.id;
    if (harmless()) return true;
    engage(b, pl, "scream");
  }
  return true;
}

/** A rattlebone landed. */
export function lure(loc, pl) {
  const b = T.brain;
  if (!b || b.vanishing || !alive(b.e)) return;
  const p = getP(pl);
  const eff = habituation(p.profile.lure);
  p.profile.lure = Math.min(12, p.profile.lure + 1);
  p.profDirty = true;
  if (dist(b.e.location, loc) > 40) return;
  if (b.state === "stalk" || b.state === "search" || (b.state === "hunt" && b.lostSince)) {
    if (!chance(0.25 + 0.75 * eff)) return;
    if (b.state === "hunt") enterSearch(b, pl);
    b.spots = [{ ...loc }];
    goTo(b, loc, b.state === "search" ? 0.26 : 0.2);
    visual(b, "search");
    if (b.state === "stalk") b.sub = "lure";
  }
}

/** A Glowspore Flare went off near it. */
export function flare(pl, loc) {
  const b = T.brain;
  if (!b || b.vanishing || !alive(b.e)) return false;
  if (b.e.dimension.id !== pl.dimension.id || dist(b.e.location, loc) > 16) return false;
  if (!clearLine(b.e.dimension, { x: loc.x, y: loc.y + 1, z: loc.z }, { x: b.e.location.x, y: b.e.location.y + 1.5, z: b.e.location.z })) return false;
  const p = getP(pl);
  const eff = habituation(p.profile.flare);
  p.profile.flare = Math.min(12, p.profile.flare + 1);
  p.profDirty = true;
  holdVisual(b, "stagger", 16);
  vocal(b, "shaftbreaker.hurt", 1.0, 0.8);
  b.slowUntil = now() + 50;
  if (!b.final && chance(0.35 + 0.6 * eff)) {
    startRetreat(b, pl, chance(0.5) ? "vanish" : "stalk");
    unlock(pl, "flare");
  } else b.enraged = true;
  return true;
}

/** It was hurt. */
export function onHurt(attacker, damage) {
  const b = T.brain;
  if (!b || b.vanishing) return;
  const t = now();
  if (attacker && attacker.typeId === "minecraft:player") {
    const pl = /** @type {import("@minecraft/server").Player} */ (attacker);
    if (b.state === "stalk" || b.state === "standoff" || b.state === "ambush" || b.state === "dormant" || b.state === "retreat" || b.state === "escort" || b.state === "search") {
      b.targetId = pl.id;
      engage(b, pl, "provoked");
      return;
    }
    if (b.state === "hunt") b.targetId = pl.id;
  }
  if (damage >= 8 && b.state === "hunt" && t - (b.staggerT || 0) > 80) {
    b.staggerT = t;
    holdVisual(b, "stagger", 14);
    b.slowUntil = t + 18;
  }
}

/** Its prey died. */
export function onPreyDeath(pl) {
  const b = T.brain;
  if (!b || b.targetId !== pl.id || b.vanishing) return;
  const p = getP(pl);
  p.profile.deaths++;
  p.profDirty = true;
  p.reprieveUntil = W.ticks + 12000;
  holdVisual(b, "scream", 40);
  vocal(b, "shaftbreaker.screech", 0.9 * cfg.screamVolume, 0.7);
  b.leaveReason = "kill";
  system.runTimeout(() => guard("killLeave", () => { if (T.brain === b && !b.vanishing) vanish(b, true); }), 60);
}

/** Plays the death animation (called when a hit is fatal). */
export function deathVisual() {
  const b = T.brain;
  if (!b) return;
  b.visualHold = 0;
  setProp(b, "attack", 0);
  setProp(b, "tilt", false);
  visual(b, "death");
}

/** Ends the brain (creature gone) and notifies the director. */
export function endBrain(b, reason) {
  if (T.brain === b) T.brain = null;
  if (alive(b.wp)) guard("wpRm", () => b.wp.remove());
  for (const pl of world.getPlayers({ tags: [PREY_TAG] })) guard("untag", () => pl.removeTag(PREY_TAG));
  stopAllMusic();
  guard("endHook", () => brainHooks.onEnd && brainHooks.onEnd(b, reason));
}

/** Admin: force a phase. */
export function forceState(st, pl) {
  const b = T.brain;
  if (!b || !pl) return false;
  if (st === "hunt") engage(b, pl, "scream");
  else if (st === "standoff") enterStandoff(b, pl);
  else if (st === "stalk") enterStalk(b, pl);
  else if (st === "search") { b.lastKnown = { ...pl.location }; enterSearch(b, pl); }
  else if (st === "leave") leave(b, "admin");
  else if (st === "vanish") vanish(b, true);
  else return false;
  return true;
}

export { PS, dot, isWater, teach, sub };
