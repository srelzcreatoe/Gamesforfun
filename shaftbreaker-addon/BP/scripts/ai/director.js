// @ts-check
// Encounter director: pacing (tension, cooldowns, grace period), choosing who it comes for and from
// where, minor psychological events between encounters, lone Dwellings, territorial responses and the
// final confrontation. Also wires world events (damage, deaths, spawns, mining noise) into the AI.
import { world, system, EntityInitializationCause, ItemStack } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { W, markDirty, hollowState } from "../core/state.js";
import { DWELLER_ID, PHANTOM_ID, WAYPOINT_ID, MOTH_ID, PREY_TAG, now, rand, randInt, chance, dist, distXZ, hash, guard, alive, center } from "../core/util.js";
import { T, threatDist } from "./threat.js";
import { PS, getP, eligible, updateEnvironment, updateMotion, detectTunnel, flushAll } from "./players.js";
import { makeNoise, lookDot, clearLine } from "./perception.js";
import { requestNav } from "./navmap.js";
import { decay } from "./memory.js";
import {
  spawnCreature, adopt, brainHooks, isSpawningSelf, onHurt, deathVisual, onPreyDeath, endBrain, organOutrage, notice, disableShield, engage, vanish,
} from "./dweller.js";
import { territoryAt } from "../world/territory.js";
import { dwellingHooks, isProtected, dwellingsNear, buildSmall, localFloor } from "../world/dwelling.js";
import { organHooks } from "../world/organs.js";
import { runIllusion } from "../fx/illusions.js";
import { stopAllMusic } from "../fx/audio.js";
import { unlock } from "../ui/journal.js";

const graceOver = (frac = 1) => W.ticks >= cfg.graceMinutes * 1200 * frac;

/** every 20 ticks */
export function directorTick() {
  if (!cfg.enabled) {
    if (T.brain) vanish(T.brain, false);
    return;
  }
  const players = world.getAllPlayers();
  if (!players.length) return;
  W.ticks += 20;
  if (W.ticks % 200 === 0) markDirty();
  const t = now();
  for (const pl of players) {
    guard("dirPlayer", () => {
      const p = getP(pl);
      updateEnvironment(pl, p);
      const tr = pl.dimension.id === "minecraft:overworld" ? territoryAt(pl.location) : null;
      p.terr = tr;
      p.terrS = tr ? tr.s : 0;
      if (tr && tr.s > 0.3) unlock(pl, "territory");
      decay(p);
      const ok = eligible(pl);
      if (p.underground && ok) {
        let rate = 0.22 * (1 + p.depth) * (p.light < 5 ? 1.5 : 1) * (tr ? 1.6 + tr.s * 1.4 : 1) * cfg.encounterRate;
        if (T.brain) rate *= 0.3;
        p.tension = Math.min(100, p.tension + rate);
      } else p.tension = Math.max(0, p.tension - 1.5);
      if (p.tunnel) { p.profile.strip = Math.min(10, p.profile.strip + 0.03); p.profDirty = true; }
      if (p.underground) {
        p.profile.lookBack = Math.min(10, p.profile.lookBack * 0.997 + (p.turnBacks > 0 ? 0.04 : 0));
        p.turnBacks = 0;
        try { if (pl.isSprinting) makeNoise(pl.location, 15, "sprint", pl.id); } catch { /* */ }
        if (T.brain || p.tension > 40) requestNav(pl, p);
      }
      clawSense(pl);
      // minor psychological events between (and during) encounters
      if (cfg.minorEvents && cfg.illusions && ok && p.underground && graceOver(0.35) && t >= p.nextMinor && p.tension > 18) {
        const stalkingMe = T.brain && T.brain.targetId === pl.id && (T.brain.state === "stalk" || T.brain.state === "ambush");
        if (!T.brain || stalkingMe) {
          if (runIllusion(pl, p)) p.tension = Math.max(0, p.tension - 6);
        }
        const base = randInt(700, 1600) / Math.max(0.25, cfg.illusionRate);
        p.nextMinor = t + Math.floor(base * (p.terrS > 0.3 ? 0.6 : 1) * (stalkingMe ? 0.6 : 1));
      }
    });
  }
  guard("encounter", tryEncounter);
  if (W.ticks % 200 === 0) guard("shelter", tryOccupiedShelter);
  if (W.ticks % 1200 === 0) guard("lone", tryLoneDwelling);
  if (W.ticks % 200 === 0) flushAll();
}

function clawSense(pl) {
  const b = T.brain;
  if (!b) return;
  try {
    const eq = /** @type {any} */ (pl.getComponent("minecraft:equippable"));
    const main = eq && eq.getEquipment("Mainhand");
    const off = eq && eq.getEquipment("Offhand");
    const has = (main && main.typeId === "shaftbreaker:shaftbreaker_claw") || (off && off.typeId === "shaftbreaker:shaftbreaker_claw");
    if (!has || threatDist(pl) > 36) return;
    const l = b.e.location;
    pl.spawnParticle("shaftbreaker:eye_glint_red", { x: l.x, y: l.y + 2.6, z: l.z });
  } catch { /* */ }
}

function encounterGap() {
  return (W.lastWasHunt ? cfg.recoverySeconds : cfg.minEncounterGap) * 20;
}

function tryEncounter() {
  if (T.brain || !graceOver() || W.ticks < W.deathCooldownUntil) return;
  if (W.ticks - W.lastEncounterEnd < encounterGap()) return;
  let best = null;
  for (const pl of world.getAllPlayers()) {
    const p = getP(pl);
    if (!eligible(pl) || !p.underground || pl.dimension.id !== "minecraft:overworld") continue;
    if (W.ticks < p.reprieveUntil || p.tension < 45 || now() < p.silenceUntil) continue;
    if (isProtected(pl.location)) continue;
    if (!best || p.tension > getP(best).tension) best = pl;
  }
  if (!best) return;
  const p = getP(best);
  const chanceNow = Math.pow((p.tension - 40) / 60, 1.3) * 0.12 * cfg.encounterRate * (p.terrS > 0.3 ? 1.6 : 1);
  if (!chance(chanceNow)) return;
  requestNav(best, p);
  if (!p.nav || !p.nav.ok || p.nav.cells.length < 20) return;
  const pl = best;
  if (p.terrS > 0.25) {
    // the Missing Beat: the cavern's pulse stops shortly before it moves
    p.silenceUntil = now() + 90;
    system.runTimeout(() => guard("spawnDelayed", () => { if (!T.brain && alive(pl)) startEncounter(pl, getP(pl)); }), 80);
  } else startEncounter(pl, p);
}

/** pick a reachable cell out of the player's sight */
function hiddenCell(pl, p, minD, maxD, near) {
  const cells = p.nav && p.nav.cells;
  if (!cells) return null;
  const head = pl.getHeadLocation();
  const cand = [];
  for (let i = 0; i < Math.min(cells.length, 400); i++) {
    const c = cells.length > 400 ? cells[Math.floor(rand() * cells.length)] : cells[i];
    if (c.water) continue;
    const pos = { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
    const d = dist(pos, pl.location);
    if (d < minD || d > maxD) continue;
    if (near && dist(pos, near) > 5) continue;
    const top = { x: pos.x, y: pos.y + 1.8, z: pos.z };
    if (lookDot(pl, top) > 0.35) continue;
    cand.push({ c, pos, top });
  }
  for (let i = 0; i < 10 && cand.length; i++) {
    const k = cand.splice(Math.floor(rand() * cand.length), 1)[0];
    if (lookDot(pl, k.top) < 0.0 || !clearLine(pl.dimension, head, k.top)) return k;
  }
  return null;
}

/** @param {import("@minecraft/server").Player} pl */
export function startEncounter(pl, p, start = "stalk") {
  if (T.brain) return false;
  requestNav(pl, p);
  let spot = null;
  let tunnel = false;
  if (start === "stalk" && p.tunnel && (p.profile.strip >= 1.5 || chance(0.45))) {
    spot = hiddenCell(pl, p, 9, 40, p.tunnel.start);
    tunnel = !!spot;
  }
  if (!spot) spot = hiddenCell(pl, p, start === "stalk" ? 22 : 12, start === "stalk" ? 40 : 24);
  if (!spot) spot = hiddenCell(pl, p, 12, 44);
  if (!spot) return false;
  const b = spawnCreature(pl, spot.pos, { start, tunnel });
  if (!b) return false;
  p.tension = 15;
  p.lastEventAt = now();
  return true;
}

// ------------------------------------------------------------------ the Occupied Shelter
function tryOccupiedShelter() {
  if (T.brain || !cfg.dwellings || !graceOver() || W.ticks - W.lastEncounterEnd < encounterGap()) return;
  for (const pl of world.getAllPlayers()) {
    if (!eligible(pl) || pl.dimension.id !== "minecraft:overworld") continue;
    const p = getP(pl);
    if (W.ticks < p.reprieveUntil) continue;
    for (const d of dwellingsNear(pl.location, 30)) {
      const dd = dist(pl.location, d);
      if (dd < 14 || !chance(0.3)) continue;
      const pos = { x: d.x + 0.5 + (d.big ? 2 : 0), y: d.y, z: d.z + 0.5 };
      if (lookDot(pl, { x: pos.x, y: pos.y + 1.5, z: pos.z }) > 0.4) continue;
      const fy = localFloor(pl.dimension, Math.floor(pos.x), Math.floor(pos.z), d.y, 2, 3);
      if (fy === null) continue;
      spawnCreature(pl, { x: pos.x, y: fy + 1, z: pos.z }, { start: "dormant" });
      unlock(pl, "dwelling");
      return;
    }
  }
}

// ------------------------------------------------------------------ lone Dwellings in ordinary caves
function tryLoneDwelling() {
  if (!cfg.dwellings || !cfg.loneDwellings) return;
  const w = /** @type {any} */ (W);
  if (!w.loneCells) w.loneCells = [];
  for (const pl of world.getAllPlayers()) {
    const p = getP(pl);
    if (!p.underground || p.terrS > 0.05 || pl.dimension.id !== "minecraft:overworld") continue;
    const cx = Math.floor(pl.location.x / 256);
    const cz = Math.floor(pl.location.z / 256);
    const ck = cx + "," + cz;
    if (w.loneCells.includes(ck) || hash(cx, cz, W.salt, 77) > 0.24) continue;
    if (dwellingsNear(pl.location, 180, false).length) { w.loneCells.push(ck); continue; }
    requestNav(pl, p);
    const spot = hiddenCell(pl, p, 20, 40);
    if (!spot || !spot.c.tall) continue;
    w.loneCells.push(ck);
    if (w.loneCells.length > 300) w.loneCells.shift();
    markDirty();
    system.runJob((function* () { try { yield* buildSmall(pl.dimension, spot.pos); } catch { /* */ } })());
    return;
  }
}

// ------------------------------------------------------------------ hooks
brainHooks.onEnd = (b, reason) => {
  W.lastEncounterEnd = W.ticks;
  W.lastWasHunt = !!b.huntStart;
  markDirty();
  stopAllMusic();
};

dwellingHooks.onDestroyed = (d, player) => {
  const dim = world.getDimension("overworld");
  for (const pl of dim.getPlayers({ location: d, maxDistance: 160 })) {
    guard("dScream", () => {
      pl.playSound("shaftbreaker.scream_far", { volume: 1.0 * cfg.screamVolume, pitch: 0.75 });
      pl.playSound("shaftbreaker.rumble", { volume: 1.0 });
    });
    unlock(pl, "dwelling_destroyed");
  }
  if (!player || cfg.aggression <= 0) return;
  if (!chance(cfg.finalConfrontation / 100)) return;
  T.finalPending = true;
  if (T.brain && alive(T.brain.e)) {
    T.brain.final = true;
    T.brain.enraged = true;
    engage(T.brain, player, "scream");
    unlock(player, "final");
    return;
  }
  system.runTimeout(() => guard("final", () => {
    T.finalPending = false;
    if (T.brain || !alive(player)) return;
    const p = getP(player);
    requestNav(player, p);
    const spot = hiddenCell(player, p, 12, 26) || hiddenCell(player, p, 8, 36);
    if (!spot) return;
    const b = spawnCreature(player, spot.pos, { start: "scream", final: true, enraged: true });
    if (b) {
      b.finalDwelling = d.id;
      unlock(player, "final");
    }
  }), randInt(100, 220));
};

organHooks.onOrganBroken = (loc, kind, pl) => {
  unlock(pl, kind === "core" ? "organ" : "pod");
  if (organOutrage(loc, pl)) return;
  // no creature around: it may come to answer
  if (kind !== "core" || cfg.aggression <= 0 || T.brain || !graceOver(0.5)) return;
  const tr = territoryAt(loc);
  if (!tr || !chance(0.55)) return;
  system.runTimeout(() => guard("organResp", () => {
    if (T.brain || !alive(pl)) return;
    const p = getP(pl);
    requestNav(pl, p);
    const spot = hiddenCell(pl, p, 14, 30);
    if (spot) {
      const b = spawnCreature(pl, spot.pos, { start: "scream", enraged: true });
      void b;
    }
  }), randInt(60, 140));
};

organHooks.onPodSees = (loc, pl) => {
  if (T.brain) notice(pl.location, pl);
  else { const p = getP(pl); p.tension = Math.min(100, p.tension + 5); }
};

// ------------------------------------------------------------------ world events
world.afterEvents.playerBreakBlock.subscribe((ev) => {
  guard("breakTrack", () => {
    const pl = ev.player;
    const p = getP(pl);
    const t = now();
    const l = ev.block.location;
    const gap = t - p.lastBreak;
    if (gap < 60) {
      p.streak++;
      p.profile.rhythm = p.profile.rhythm * 0.8 + Math.min(30, Math.max(4, gap)) * 0.2;
    } else p.streak = 1;
    p.lastBreak = t;
    p.breaks.push({ x: l.x, y: l.y, z: l.z, t });
    if (p.breaks.length > 40) p.breaks.shift();
    if (p.breaks.length % 4 === 0) detectTunnel(p);
    if (p.underground) makeNoise({ x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 }, 18, "mine", pl.id);
  });
});

world.afterEvents.explosion.subscribe((ev) => {
  guard("boom", () => {
    const blocks = ev.getImpactedBlocks();
    const src = ev.source;
    const loc = blocks.length ? blocks[0].location : src ? src.location : null;
    if (!loc) return;
    makeNoise(loc, 56, "explosion");
    for (const pl of ev.dimension.getPlayers({ location: loc, maxDistance: 40 })) {
      const p = getP(pl);
      p.profile.boom++;
      p.profDirty = true;
    }
    // explosions frighten it at first; repeated ones lose their effect (learned per player)
    const b = T.brain;
    if (b && alive(b.e) && dist(b.e.location, loc) < 20 && (b.state === "stalk" || b.state === "standoff" || b.state === "search")) {
      const pl = /** @type {any} */ (world.getEntity(b.targetId));
      const tol = pl ? getP(pl).profile.boom : 0;
      if (chance(Math.max(0.1, 0.8 - tol * 0.12))) vanish(b, true);
    }
  });
});

world.afterEvents.entityHurt.subscribe((ev) => {
  guard("hurt", () => {
    const e = ev.hurtEntity;
    if (e.typeId === DWELLER_ID) {
      if (T.brain && T.brain.id === e.id) {
        const hp = /** @type {any} */ (e.getComponent("minecraft:health"));
        if (hp && hp.currentValue <= 0) deathVisual();
        else onHurt(ev.damageSource.damagingEntity, ev.damage);
      }
      return;
    }
    const src = ev.damageSource.damagingEntity;
    if (e.typeId === "minecraft:player" && src && src.typeId === DWELLER_ID) {
      if (cfg.darknessOnHit && cfg.screenEffects) /** @type {any} */ (e).addEffect("darkness", 60, { amplifier: 0, showParticles: false });
    }
  });
});

world.afterEvents.entityHitEntity.subscribe((ev) => {
  guard("hit", () => {
    if (ev.damagingEntity.typeId !== DWELLER_ID || ev.hitEntity.typeId !== "minecraft:player") return;
    const pl = /** @type {any} */ (ev.hitEntity);
    if (!pl.isSneaking) return;
    const eq = pl.getComponent("minecraft:equippable");
    const off = eq && eq.getEquipment("Offhand");
    const main = eq && eq.getEquipment("Mainhand");
    if ((off && off.typeId === "minecraft:shield") || (main && main.typeId === "minecraft:shield")) disableShield(pl);
  });
});

world.afterEvents.entityDie.subscribe((ev) => {
  guard("die", () => {
    const e = ev.deadEntity;
    let tid = "";
    try { tid = e.typeId; } catch { return; }
    if (tid === DWELLER_ID) {
      const killer = ev.damageSource.damagingEntity;
      const b = T.brain;
      const wasFinal = b && b.final;
      if (killer && killer.typeId === "minecraft:player") {
        const kp = /** @type {any} */ (killer);
        const p = getP(kp);
        p.profile.kills++;
        p.profDirty = true;
        unlock(kp, "killed");
      }
      W.deathCooldownUntil = W.ticks + (wasFinal ? 48000 : 30000);
      W.dwellerKills++;
      let at = b ? b.lastPos : null;
      try { at = { ...e.location }; } catch { /* entity already gone */ }
      if (b) { b.leaveReason = "killed"; endBrain(b, "killed"); }
      if (wasFinal && at) {
        for (const d of W.dwellings) if (!d.alive && dist(d, at) < 200) d.cleansed = true;
      }
      markDirty();
      return;
    }
    if (tid === "minecraft:player") {
      onPreyDeath(/** @type {any} */ (e));
      const p = PS.get(e.id);
      if (p && T.brain && T.brain.targetId === e.id) unlock(/** @type {any} */ (e), "died");
      return;
    }
    if (tid === MOTH_ID) {
      const k = ev.damageSource.damagingEntity;
      if (k && k.typeId === "minecraft:player") { W.anger = Math.min(100, W.anger + 1); markDirty(); }
    }
  });
});

world.afterEvents.entitySpawn.subscribe((ev) => {
  guard("spawn", () => {
    const e = ev.entity;
    if (!alive(e) || e.typeId !== DWELLER_ID || isSpawningSelf()) return;
    if (ev.cause !== EntityInitializationCause.Spawned && ev.cause !== EntityInitializationCause.Event) return;
    system.run(() => guard("adopt", () => {
      if (!alive(e)) return;
      if (!cfg.enabled) { e.remove(); return; }
      const near = e.dimension.getPlayers({ location: e.location, maxDistance: 64 });
      if (!near.length) { e.remove(); return; }
      near.sort((a, c) => dist(a.location, e.location) - dist(c.location, e.location));
      guard("tier", () => e.triggerEvent("shaftbreaker:tier_" + cfg.tier));
      adopt(e, near[0], dist(near[0].location, e.location) < 20 ? "standoff" : "stalk");
    }));
  });
});

// stale creatures / helpers from a previous session are cleaned up when their chunk loads
world.afterEvents.entityLoad.subscribe((ev) => {
  guard("load", () => {
    const e = ev.entity;
    const id = e.typeId;
    if (id === DWELLER_ID && (!T.brain || T.brain.id !== e.id)) e.remove();
    else if (id === PHANTOM_ID && !T.phantoms.some((p) => alive(p) && p.id === e.id)) e.remove();
    else if (id === WAYPOINT_ID && (!T.brain || !T.brain.wp || T.brain.wp.id !== e.id)) e.remove();
  });
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  guard("pspawn", () => {
    const pl = ev.player;
    if (pl.hasTag(PREY_TAG) && (!T.brain || T.brain.targetId !== pl.id)) pl.removeTag(PREY_TAG);
    const p = getP(pl);
    if (ev.initialSpawn) {
      // safe reconnect: never resume a hunt with the creature already in striking range
      if (T.brain && T.brain.targetId === pl.id && threatDist(pl) < 20) vanish(T.brain, false);
      if (!p.profile.gotItems) {
        p.profile.gotItems = true;
        p.profDirty = true;
        system.runTimeout(() => guard("give", () => {
          const inv = /** @type {any} */ (pl.getComponent("minecraft:inventory"));
          if (!inv || !inv.container) return;
          inv.container.addItem(new ItemStack("shaftbreaker:config_wheel", 1));
          inv.container.addItem(new ItemStack("shaftbreaker:field_journal", 1));
          pl.sendMessage("§8§oYou feel like something below is listening. (Shaftbreaker: use the Config Wheel to adjust the experience.)");
        }), 100);
      }
    }
  });
});

/** On world load: remove any creature left from a previous session (encounters never resume mid-way). */
export function cleanupOnLoad() {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    guard("cleanup", () => {
      const dim = world.getDimension(dimId);
      for (const e of dim.getEntities({ type: DWELLER_ID })) e.remove();
      for (const e of dim.getEntities({ type: PHANTOM_ID })) e.remove();
      for (const e of dim.getEntities({ type: WAYPOINT_ID })) e.remove();
    });
  }
  for (const pl of world.getPlayers({ tags: [PREY_TAG] })) guard("untag", () => pl.removeTag(PREY_TAG));
}

export { center, distXZ, hollowState };
