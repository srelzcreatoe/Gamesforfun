// @ts-check
// Its hunt in the Rift (1.6.0). The Rift is its own: there it does not wait for stages, quiet spells or the right
// moment. It is always there, always moving: glimpsed between the trees, laughing somewhere off in the rain, standing
// right behind you when the lightning comes, blood running down the trunks round you — and then it comes, through the
// air, faster than you can run, and strikes, and strikes again, and is gone, and comes again.
//
// How hard is set by how often rifts open (the Config Wheel's Rift setting, 1 to 5): the more often, the hungrier it
// is when you come through — faster, harder-hitting, quicker to strike, quicker to come again, and cleverer: at the
// top it cuts ahead of you again and again, never loses you, waits between you and the way out, and comes for you at
// the chests. Its blow still has a wind-up you can step out of; the Witness Lens, a flare or a blow still drive it
// off for a while; on aggression "never" it never hurts you (it throws you back to the stones instead).
//
// Each round is one encounter of the director's (rift_hunt: no history, no pacing, no pause for anyone else); this
// module starts them, one after another, for whoever is in the Rift.
import { system, GameMode } from "@minecraft/server";
import { register, start, encounterFor, activeEncounter, byId, control } from "../director/director.js";
import * as body from "../observer/body.js";
import * as talk from "../observer/talk.js";
import { SOUNDS, PARTICLES } from "../core/constants.js";
import { S } from "../core/settings.js";
import { V, safe, emit, rand, randInt, chance, allPlayers, DEBUG } from "../core/util.js";
import { now } from "../core/state.js";
import { findSpot, hideSpot, standNear } from "../world/space.js";
import { relentless, sighting } from "../encounters/common.js";
import { RIFT_ID } from "./dimension.js";
import * as realm from "./realm.js";
import * as sky from "./atmosphere.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("../director/encounter.js").Encounter} Encounter */
/** @typedef {{x:number,y:number,z:number}} Vec */

/**
 * By level (the Rift setting, 1 rare .. 5 constant). Ticks unless said.
 *   stalk    how long it toys with you before it comes [min, max]
 *   rest     the gap between one round and the next [min, max]
 *   pace     [slowest b/s, times your speed, fastest b/s] (a sprint is about 5.6)
 *   dmg      its blow (hit points; a heart is 2)   windup: before the blow lands   recover: after it
 *   chase    how long one charge lasts             lose: how far you must get to lose it (blocks)
 *   aheads   how often it may cut ahead of you in one charge, and the gap between
 *   behind   the chance it is right behind you when you turn round; ambush: at the chests; guard: at the way out
 *   warn     the wind-up before it charges (a stare, a shriek)
 *   rage     it shrieks and comes enraged
 */
export const HUNT = [
  null,
  { stalk: [260, 400], rest: [420, 640], pace: [4.6, 1.0, 6.0], dmg: 4, windup: 12, recover: 10, chase: 500, lose: 72, aheads: 1, gap: 200, behind: 0.15, ambush: 0.15, guard: 0, warn: 40, rage: false },
  { stalk: [200, 320], rest: [320, 500], pace: [5.4, 1.08, 7.2], dmg: 6, windup: 11, recover: 9, chase: 600, lose: 96, aheads: 2, gap: 160, behind: 0.3, ambush: 0.25, guard: 0.2, warn: 30, rage: false },
  { stalk: [140, 240], rest: [220, 360], pace: [6.4, 1.16, 8.6], dmg: 8, windup: 10, recover: 8, chase: 700, lose: 140, aheads: 3, gap: 130, behind: 0.45, ambush: 0.4, guard: 0.45, warn: 18, rage: false },
  { stalk: [90, 170], rest: [140, 260], pace: [7.4, 1.25, 10.2], dmg: 10, windup: 8, recover: 6, chase: 800, lose: 1e9, aheads: 5, gap: 90, behind: 0.6, ambush: 0.55, guard: 0.7, warn: 8, rage: true },
  { stalk: [50, 110], rest: [70, 150], pace: [8.6, 1.35, 12.0], dmg: 13, windup: 7, recover: 5, chase: 900, lose: 1e9, aheads: 8, gap: 60, behind: 0.75, ambush: 0.7, guard: 0.9, warn: 0, rage: true },
];

/** The level it hunts at now (a player still in there after rifts were switched off gets the gentlest). */
export function level() {
  const r = Math.round(Number(S().rift));
  return Math.max(1, Math.min(5, Number.isFinite(r) ? r : 2));
}
/** @param {number} [L] */
export const cfgFor = (L = level()) => /** @type {NonNullable<(typeof HUNT)[1]>} */ (HUNT[L] ?? HUNT[2]);

/** Its pace, blow and wind-up at this level, for the body. @param {ReturnType<typeof cfgFor>} c @returns {import("../observer/body.js").Boost} */
const boostOf = (c) => ({ pace: [c.pace[0], c.pace[1], c.pace[2]], dmg: c.dmg, windup: c.windup });

/** When each player's next round may start (game seconds). @type {Map<string, number>} */
const nextAt = new Map();
/** Where each was last tick, to tell which way they are going. @type {Map<string, Vec>} */
const lastAt = new Map();

/** A player came through: a moment to look round first. @param {Player} p */
export function arrived(p) {
  const c = cfgFor();
  nextAt.set(p.id, now() + Math.max(2, c.stalk[0] / 40));
  lastAt.delete(p.id);
}
/** @param {string} pid */
export function forget(pid) {
  nextAt.delete(pid);
  lastAt.delete(pid);
}

// ---------------------------------------------------------------- what it does between its charges

/** @param {Encounter} enc */
async function glimpse(enc) {
  const p = enc.p;
  // between the trees, in front of them, half hidden — looking at them
  const tree = hideSpot(p, { minDist: 14, maxDist: 26, samples: 30, treesOnly: true });
  const spot = tree ?? findSpot(p, { minDist: 14, maxDist: 26, bearings: [0, 35, -35], spread: 25, concealment: "visible", needLOS: true, yMode: "surface" });
  if (!spot) return false;
  const b = enc.spawnBody(spot.loc, { state: tree ? "peek" : "watch", hide: tree?.hide, silent: true });
  if (!b) return false;
  body.setBoost(boostOf(cfgFor()));
  enc.emit("rift", { what: "glimpse", d: Math.round(V.dist(spot.loc, p.location)) });
  // gone once they have looked at it a moment, or after a few seconds
  const seen = await enc.until(() => {
    enc.updateGaze();
    return enc.gaze.seenTicks >= 10;
  }, randInt(50, 80), 2);
  if (seen) enc.worldSound(SOUNDS.glitch, spot.loc, 0.8, 0.8);
  body.despawn(seen ? "blink" : "vanished");
  return true;
}

/** Right behind them. If they turn round in time they see it — and if it is hungry enough, that is when it comes. @param {Encounter} enc */
async function behind(enc) {
  const p = enc.p;
  const back = V.add(p.location, V.scale(V.fromYaw(p.getRotation().y + 180), rand(3.5, 6)));
  const st = standNear(enc.dim, back.x, back.z, p.location.y);
  if (!st) return false;
  if (!enc.spawnBody(st.loc, { state: "stare", silent: true })) return false;
  body.setBoost(boostOf(cfgFor()));
  enc.sound(SOUNDS.breath, p.getHeadLocation(), 0.9, 0.8);
  enc.emit("rift", { what: "behind" });
  const turned = await enc.until(() => body.visibleTo([p]), randInt(40, 70), 2);
  if (turned) {
    enc.discover("right_behind_you");
    return "turned";
  }
  body.despawn("blink");
  return true;
}

/** It laughs somewhere off in the rain; or its footsteps go round them. @param {Encounter} enc */
function sounds(enc) {
  const p = enc.p;
  const dir = V.fromYaw(rand(0, 360));
  const at = V.add(p.location, V.scale(dir, rand(10, 18)));
  if (chance(0.5)) enc.sound(chance(0.5) ? SOUNDS.voice : SOUNDS.whisper, { x: at.x, y: at.y + 2, z: at.z }, 0.9, rand(0.7, 1.1));
  else for (let i = 0; i < 6; i++) system.runTimeout(() => {
    if (!p.isValid) return;
    const a = V.add(p.location, V.scale(V.fromYaw(i * 40 + rand(0, 20)), 7));
    safe(() => p.playSound(SOUNDS.step, { location: a, volume: 0.6, pitch: rand(0.8, 1) }));
  }, i * 7);
  if (chance(0.35)) talk.react(p, "rift_taunt", 1);
  enc.emit("rift", { what: "sounds" });
  return true;
}

/** The trees round them bleed. @param {Encounter} enc */
function bleed(enc) {
  const p = enc.p;
  const l = p.location;
  for (let k = 0; k < 24; k++) {
    const x = Math.floor(l.x + rand(-7, 7)), z = Math.floor(l.z + rand(-7, 7));
    const y = Math.floor(l.y);
    const b = safe(() => enc.dim.getBlock({ x, y: y + 2, z }));
    if (!b || b.typeId !== "observer:rift_bark") continue;
    for (let i = 0; i < 6; i++) {
      system.runTimeout(() => safe(() => enc.dim.spawnParticle(PARTICLES.eyeDrip, { x: x + 0.5 + rand(-0.4, 0.4), y: y + 3.2 - i * 0.15, z: z + 0.5 + rand(-0.4, 0.4) })), i * 6);
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const g = safe(() => enc.dim.getBlock({ x: x + dx, y, z: z + dz }));
      if (g?.isAir && !safe(() => g.below()?.isAir, true) && chance(0.5)) safe(() => g.setType("observer:blood"));
    }
    enc.sound(SOUNDS.crack, { x: x + 0.5, y: y + 2, z: z + 0.5 }, 0.5, 0.6);
    enc.emit("rift", { what: "bleed" });
    return true;
  }
  return false;
}

/** Lightning — and in the flash it is standing there, close, in plain sight. Gone when the light goes. @param {Encounter} enc */
async function flash(enc) {
  const p = enc.p;
  const spot = findSpot(p, { minDist: 7, maxDist: 12, bearings: [0, 25, -25], spread: 15, concealment: "visible", yMode: "surface" });
  sky.lightning(p, spot ? 0.9 : 0.5);
  if (!spot) return true;
  if (!enc.spawnBody(spot.loc, { state: "stare", silent: true })) return true;
  enc.emit("rift", { what: "flash", d: Math.round(V.dist(spot.loc, p.location)) });
  await enc.wait(randInt(8, 14));
  body.despawn("blink");
  return true;
}

// ---------------------------------------------------------------- the charge

/** Where it comes from this time. @param {Encounter} enc @param {ReturnType<typeof cfgFor>} c */
function chargeFrom(enc, c) {
  const p = enc.p;
  const l = p.location;
  // making for the way out: it is between them and it
  const toExit = V.flat(V.sub(realm.EXIT, l));
  const dExit = V.hdist(realm.EXIT, l);
  const was = lastAt.get(p.id);
  const going = was ? V.flat(V.sub(l, was)) : undefined;
  if (c.guard && dExit < 48 && dExit > 9 && going && V.dot(V.norm(going), V.norm(toExit)) > 0.6 && chance(c.guard)) {
    const at = V.add(l, V.scale(V.norm(toExit), Math.min(dExit - 3, rand(7, 11))));
    const st = standNear(enc.dim, at.x, at.z, l.y);
    if (st) {
      talk.react(p, "rift_guard", 0.8);
      return { loc: st.loc, how: "guard" };
    }
  }
  // at the chests: it was waiting in there
  const chest = nearChest(enc, 12);
  if (chest && chance(c.ambush)) {
    const st = findSpot(p, { minDist: 5, maxDist: 10, bearings: [180, 120, -120], spread: 40, concealment: "hidden", yMode: "near" });
    if (st) {
      talk.react(p, "rift_loot", 0.8);
      return { loc: st.loc, how: "ambush" };
    }
  }
  // from behind, out of sight; or ahead of them, cutting them off
  const ahead = chance(0.35);
  const spot = findSpot(p, { minDist: ahead ? 14 : 12, maxDist: ahead ? 22 : 20, bearings: ahead ? [0, 30, -30] : [180, 140, -140], spread: 30,
    concealment: ahead ? "any" : "hidden", yMode: "surface" });
  return spot ? { loc: spot.loc, how: ahead ? "ahead" : "behind" } : undefined;
}

/** A chest or barrel within reach of them, if any. @param {Encounter} enc @param {number} r */
function nearChest(enc, r) {
  const l = enc.p.location;
  for (let k = 0; k < 20; k++) {
    const at = { x: Math.floor(l.x + rand(-r, r)), y: Math.floor(l.y + rand(-3, 3)), z: Math.floor(l.z + rand(-r, r)) };
    const b = safe(() => enc.dim.getBlock(at));
    if (b && (b.typeId === "minecraft:chest" || b.typeId === "minecraft:barrel")) return at;
  }
  return undefined;
}

/** @param {Encounter} enc @param {ReturnType<typeof cfgFor>} c @param {Vec} [from] */
async function charge(enc, c, from) {
  const p = enc.p;
  let at = from;
  let how = "behind_you";
  if (!at) {
    const f = chargeFrom(enc, c);
    if (!f) return "no_spot";
    at = f.loc;
    how = f.how;
    if (!enc.spawnBody(at, { state: "stare", silent: true })) return "no_body";
  }
  body.setBoost(boostOf(c));
  enc.emit("rift", { what: "charge", how, level: level(), d: Math.round(V.dist(at, p.location)) });
  // the warning: a stare and its hum (lower levels), or only its shriek
  if (c.warn > 0) {
    enc.sound(SOUNDS.hum, at, 1, 0.9);
    body.setState("stare");
    await enc.wait(c.warn);
  }
  sighting(enc, p);
  const out = await relentless(enc, { rage: c.rage, maxTicks: c.chase, loseAt: c.lose, think: { aheads: c.aheads, gap: c.gap }, recover: c.recover, always: true });
  enc.emit("rift", { what: "charge_end", outcome: out });
  if (out === "caught") {
    // aggression "never": it never hurts them. It throws them back to the stones instead.
    enc.fade(0.1, 0.6, 1.0);
    await enc.wait(10);
    safe(() => p.teleport(realm.ARRIVE, { facingLocation: { x: realm.ARRIVE.x, y: realm.ARRIVE.y + 1, z: realm.ARRIVE.z + 10 } }));
    talk.react(p, "rift_back", 1);
  }
  return out;
}

// ---------------------------------------------------------------- one round

register({
  id: "rift_hunt",
  manual: true,
  rift: true,
  needsBody: true,
  reactNear: false,
  tier: 4,
  minStage: 0,
  cooldown: 0,
  weight: () => 0,
  async run(enc) {
    const p = enc.p;
    const c = cfgFor();
    enc.restoreDelay = 20;
    enc.data.rift = true;
    const stalkEnd = randInt(c.stalk[0], c.stalk[1]);
    let t = 0;
    // it toys with them first
    while (t < stalkEnd) {
      const gap = randInt(50, 90);
      await enc.wait(gap);
      t += gap;
      const roll = Math.random();
      let did;
      if (roll < c.behind * 0.6) {
        did = await behind(enc);
        if (did === "turned") {
          // they turned round, and it was right there: it comes now
          enc.worldSound(SOUNDS.shriek, body.loc() ?? p.location, 1);
          const out = await charge(enc, c, body.loc());
          enc.data.outcome = out;
          return;
        }
      } else if (roll < 0.45) did = await glimpse(enc);
      else if (roll < 0.62) did = sounds(enc);
      else if (roll < 0.78) did = bleed(enc);
      else did = await flash(enc);
      if (!did) sounds(enc);
      t += 20;
    }
    // and then it comes
    const out = await charge(enc, c);
    enc.data.outcome = out;
  },
});

// ---------------------------------------------------------------- whose round, and when

/** Every second: start the next round for whoever in the Rift is due one. */
export function tick() {
  const def = byId("rift_hunt");
  if (!def || !S().enabled || (control.paused && DEBUG.riftHunt !== "on")) return;
  const t = now();
  const inside = allPlayers().filter((p) => safe(() => p.dimension.id === RIFT_ID, false));
  for (const p of inside) {
    const was = lastAt.get(p.id);
    const l = p.location;
    if (!was || V.dist(was, l) > 1.5) lastAt.set(p.id, { x: l.x, y: l.y, z: l.z });
  }
  const act = activeEncounter();
  // a round going on in the Rift: nothing to start
  if (act && act.def.id === "rift_hunt" && act.p.isValid && act.p.dimension.id === RIFT_ID) return;
  // who is due (the longest waiting first)
  const due = inside
    .filter((p) => {
      const gm = safe(() => p.getGameMode(), GameMode.Creative);
      const hp = safe(() => p.getComponent("minecraft:health")?.currentValue, 0) ?? 0;
      return (gm === GameMode.Survival || gm === GameMode.Adventure) && hp > 0 && !encounterFor(p.id) && t >= (nextAt.get(p.id) ?? 0);
    })
    .sort((a, b) => (nextAt.get(a.id) ?? 0) - (nextAt.get(b.id) ?? 0));
  const p = due[0];
  if (!p) return;
  const enc = start(def, p, undefined, true);
  if (!enc) return;
  const c = cfgFor();
  // the next round for this player: after this one, and a rest
  nextAt.set(p.id, t + 1e9);
  watchEnd(enc, p.id, c);
}

/** When a round ends, set when the next comes (longer if they drove it off). @param {Encounter} enc @param {string} pid @param {ReturnType<typeof cfgFor>} c */
function watchEnd(enc, pid, c) {
  const id = system.runInterval(() => {
    if (activeEncounter() === enc || encounterFor(pid) === enc) return;
    system.clearRun(id);
    const out = String(enc.data.outcome ?? enc.outcome ?? "");
    let rest = rand(c.rest[0], c.rest[1]) / 20;
    if (/repelled|flared|struck_away|aborted:flared/.test(out) || enc.aborted === "flared") rest *= 1.6;
    nextAt.set(pid, now() + rest);
    emit("rift", { what: "round_end", outcome: out, aborted: enc.aborted, rest: Math.round(rest) });
  }, 10);
}

/** For tests: the next round now. @param {Player} p */
export function hurry(p) {
  nextAt.set(p.id, 0);
}
